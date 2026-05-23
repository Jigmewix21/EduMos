import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import {
  createClassroom,
  createGradeColumn,
  createQuiz,
  createSection,
  createTeacher,
  connectToTeacherHost,
  enrollStudent,
  findUser,
  getClassroomOfflinePackage,
  importClassroomOfflinePackage,
  deleteGradeColumn,
  listGradeColumns,
  listGrades,
  listParticipants,
  listQuizzes,
  listResources,
  listSections,
  listStudentClassrooms,
  listTeacherClassrooms,
  publishClassroomToTeacherHost,
  removeParticipant,
  saveGradeCell,
  saveGrade,
  submitGradeToTeacherHost,
  syncPendingWrites,
  saveResource,
  updateGradeColumn,
  updateQuiz
} from "./firebase";
import { getPendingWriteCount, isOnline, listenForOnline } from "./offlineStore";

const DEFAULT_STUDENT = { email: "student1@gmail.com", password: "student123" };
const DEFAULT_TEACHER = { email: "teacher@edumos.com", password: "teacher123" };

export default function App() {
  const [screen, setScreen] = useState("home");
  const [role, setRole] = useState("student");
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState(DEFAULT_STUDENT.email);
  const [password, setPassword] = useState(DEFAULT_STUDENT.password);
  const [message, setMessage] = useState("");
  const [classrooms, setClassrooms] = useState([]);
  const [activeClassroom, setActiveClassroom] = useState(null);
  const [tab, setTab] = useState("resources");
  const [online, setOnline] = useState(isOnline());
  const [pendingWrites, setPendingWrites] = useState(getPendingWriteCount());

  async function syncNow() {
    const result = await syncPendingWrites();
    setPendingWrites(result.pending);
    return result;
  }

  useEffect(() => {
    const refreshStatus = () => {
      setOnline(isOnline());
      setPendingWrites(getPendingWriteCount());
      syncNow();
    };
    const stop = listenForOnline(refreshStatus);
    refreshStatus();
    return stop;
  }, []);

  async function login(nextRole = role) {
    const found = await findUser(nextRole, email, password);
    if (!found) {
      setMessage(`Invalid ${nextRole} login. Seed users in Firebase first.`);
      return;
    }
    setUser(found);
    setRole(nextRole);
    setScreen(nextRole === "teacher" ? "teacherDashboard" : "studentDashboard");
    setMessage("");
  }

  async function refreshClassrooms() {
    if (!user) return;
    const data = role === "teacher"
      ? await listTeacherClassrooms(user.id)
      : await listStudentClassrooms(user.id);
    setClassrooms(data);
  }

  useEffect(() => {
    refreshClassrooms();
  }, [screen, user, role]);

  function logout() {
    setUser(null);
    setActiveClassroom(null);
    setScreen("home");
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Header onHome={() => setScreen("home")} onAbout={() => setScreen("about")} onLogout={user ? logout : null} online={online} pendingWrites={pendingWrites} onSync={syncNow} />
      {screen === "home" && <Home setScreen={setScreen} setRole={setRole} setEmail={setEmail} setPassword={setPassword} />}
      {screen === "about" && <About />}
      {screen === "login" && (
        <Card>
          <Title>{role === "teacher" ? "Teacher Login" : "Student Login"}</Title>
          <Input value={email} onChangeText={setEmail} placeholder="Email" onSubmitEditing={() => login(role)} />
          <Input value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry onSubmitEditing={() => login(role)} />
          <Button title="Login" onPress={() => login(role)} />
          {role === "teacher" && <Button tone="muted" title="Create Teacher Account" onPress={() => setScreen("signup")} />}
          <Text style={styles.error}>{message}</Text>
        </Card>
      )}
      {screen === "signup" && <TeacherSignup onDone={() => setScreen("login")} />}
      {screen === "studentDashboard" && (
        <StudentDashboard
          user={user}
          classrooms={classrooms}
          onEnroll={async key => {
            const result = await enrollStudent(user, key);
            setMessage(result.ok ? `Enrolled in ${result.classroom.name}` : result.message);
            setPendingWrites(getPendingWriteCount());
            await refreshClassrooms();
          }}
          onConnected={async room => {
            setMessage(`Connected offline to ${room.name}`);
            await refreshClassrooms();
            setPendingWrites(getPendingWriteCount());
          }}
          onOpen={room => {
            setActiveClassroom(room);
            setTab("resources");
            setScreen("studentClassroom");
          }}
          message={message}
        />
      )}
      {screen === "studentClassroom" && activeClassroom && (
        <StudentClassroom classroom={activeClassroom} tab={tab} setTab={setTab} user={user} />
      )}
      {screen === "teacherDashboard" && (
        <TeacherDashboard
          user={user}
          classrooms={classrooms}
          onCreated={refreshClassrooms}
          onOpen={room => {
            setActiveClassroom(room);
            setTab("resources");
            setScreen("teacherClassroom");
          }}
        />
      )}
      {screen === "teacherClassroom" && activeClassroom && (
        <TeacherClassroom classroom={activeClassroom} tab={tab} setTab={setTab} onPendingChange={() => setPendingWrites(getPendingWriteCount())} />
      )}
    </ScrollView>
  );
}

function Header({ onHome, onAbout, onLogout, online, pendingWrites, onSync }) {
  return (
    <View style={styles.nav}>
      <Text style={styles.logo}>EduMos</Text>
      <View style={styles.navLinks}>
        <Text style={styles.statusPill}>{online ? "Online" : "Offline"} | {pendingWrites} waiting</Text>
        {pendingWrites > 0 && <Pressable onPress={onSync}><Text style={styles.navLink}>Sync</Text></Pressable>}
        <Pressable onPress={onHome}><Text style={styles.navLink}>Home</Text></Pressable>
        <Pressable onPress={onAbout}><Text style={styles.navLink}>About Us</Text></Pressable>
        {onLogout && <Pressable onPress={onLogout}><Text style={styles.navLink}>Logout</Text></Pressable>}
      </View>
    </View>
  );
}

function Home({ setScreen, setRole, setEmail, setPassword }) {
  function openLogin(nextRole) {
    setRole(nextRole);
    setEmail(nextRole === "teacher" ? DEFAULT_TEACHER.email : DEFAULT_STUDENT.email);
    setPassword(nextRole === "teacher" ? DEFAULT_TEACHER.password : DEFAULT_STUDENT.password);
    setScreen("login");
  }
  return (
    <View>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>EduMos</Text>
        <Text style={styles.heroSubtitle}>Offline learning platform for every classroom</Text>
        <Text style={styles.heroText}>Teachers can publish lessons, host a local classroom over hotspot, collect quiz work offline, and sync everything back to the website when internet returns.</Text>
        <View style={styles.loginSelection}>
          <Card tone="glass">
            <Text style={styles.loginIcon}>ST</Text>
            <Title light>Student Portal</Title>
            <Text style={styles.lightText}>Join classrooms, access resources, complete quizzes, and view grades online or offline.</Text>
            <Button tone="light" title="Student Login" onPress={() => openLogin("student")} />
          </Card>
          <Card tone="glass">
            <Text style={styles.loginIcon}>TC</Text>
            <Title light>Teacher Portal</Title>
            <Text style={styles.lightText}>Create classrooms, host hotspot learning, manage students, quizzes, resources, and grades.</Text>
            <Button tone="outline" title="Teacher Login" onPress={() => openLogin("teacher")} />
          </Card>
        </View>
      </View>
      <Title>Features</Title>
      <View style={styles.grid}>
        <Feature icon="LAN" title="Offline Access" text="Students can open downloaded course resources and quizzes without internet." />
        <Feature icon="HOST" title="Hotspot Sharing" text="Teachers host course packages locally so students connect on Wi-Fi or hotspot." />
        <Feature icon="SYNC" title="Smart Sync" text="Quiz submissions and gradebook data wait offline, then sync when internet returns." />
        <Feature icon="APK" title="Web And APK" text="The same Expo app works as a Vercel website and Android build for teachers and students." />
      </View>
      <OfflineSection />
    </View>
  );
}

function Feature({ icon, title, text }) {
  return <Card><Text style={styles.featureIcon}>{icon}</Text><Title>{title}</Title><Text>{text}</Text></Card>;
}

function OfflineSection() {
  return (
    <Card>
      <Title>Offline Mode</Title>
      <Text>Teachers download or create resources once, host the classroom from their device, and students connect locally. Student quiz results are saved on the student device and can also be sent to the teacher host while everyone is offline.</Text>
      <Text>When the teacher gets internet again, the pending data syncs back to Firebase and the deployed website.</Text>
    </Card>
  );
}

function About() {
  return (
    <View>
    <Card>
      <Title>About Us</Title>
      <Text style={styles.heading}>Bridging Education Beyond Internet Barriers</Text>
      <Text>EduMos is an offline-first learning platform for students in areas with weak or unstable internet. Teachers can share educational resources locally through Wi-Fi hotspot or local network.</Text>
      <Text>Students can access lessons, notes, videos, quizzes, and study materials without continuous internet access. Progress and quiz results can sync when the teacher reconnects.</Text>
      <Text style={styles.heading}>Our Mission</Text>
      <Text>To make digital education accessible, affordable, and reliable for students in remote and low-connectivity areas.</Text>
    </Card>
    <View style={styles.grid}>
      <Feature icon="KEY" title="Classroom Keys" text="Students join the correct teacher course with a simple enrollment key." />
      <Feature icon="QUIZ" title="Interactive Quizzes" text="Teachers publish timed quizzes and students can submit them offline." />
      <Feature icon="LIB" title="Resource Library" text="Sections keep notes, PDFs, images, audio, and videos organized by lesson." />
    </View>
    </View>
  );
}

function TeacherSignup({ onDone }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  return (
    <Card>
      <Title>Teacher Sign Up</Title>
      <Input value={name} onChangeText={setName} placeholder="Full Name" />
      <Input value={email} onChangeText={setEmail} placeholder="Email" />
      <Input value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry onSubmitEditing={async () => {
        const result = await createTeacher(name, email, password);
        setMessage(result.ok ? "Account created" : result.message);
        if (result.ok) onDone();
      }} />
      <Button title="Create Account" onPress={async () => {
        const result = await createTeacher(name, email, password);
        setMessage(result.ok ? "Account created" : result.message);
        if (result.ok) onDone();
      }} />
      <Text style={styles.error}>{message}</Text>
    </Card>
  );
}

function StudentDashboard({ user, classrooms, onEnroll, onConnected, onOpen, message }) {
  const [key, setKey] = useState("");
  const [hostUrl, setHostUrl] = useState("");
  const [hostClassroomId, setHostClassroomId] = useState("");
  const [packageText, setPackageText] = useState("");
  const [connectMessage, setConnectMessage] = useState("");
  async function connectByHost() {
    try {
      const result = await connectToTeacherHost(hostUrl, hostClassroomId, user);
      setConnectMessage(result.ok ? `Connected to ${result.classroom.name}` : result.message);
      if (result.ok) onConnected(result.classroom);
    } catch (error) {
      setConnectMessage(error.message);
    }
  }
  function importPackage() {
    try {
      const result = importClassroomOfflinePackage(JSON.parse(packageText), user);
      setConnectMessage(result.ok ? `Connected to ${result.classroom.name}` : result.message);
      if (result.ok) onConnected(result.classroom);
    } catch (_error) {
      setConnectMessage("Paste the classroom package JSON from the teacher.");
    }
  }
  return (
    <View>
      <Title>Welcome {user.name}</Title>
      <Card>
        <Input value={key} onChangeText={setKey} placeholder="Enter Classroom Key" onSubmitEditing={() => onEnroll(key)} />
        <Button title="Enroll In Classroom" onPress={() => onEnroll(key)} />
        <Text>{message}</Text>
      </Card>
      <Card>
        <Title>Connect To Teacher Host</Title>
        <Text>Use this on the teacher hotspot Wi-Fi. Enter the teacher LAN address and course id, or paste the offline classroom package.</Text>
        <Input value={hostUrl} onChangeText={setHostUrl} placeholder="Teacher host URL, example http://192.168.43.1:10000" />
        <Input value={hostClassroomId} onChangeText={setHostClassroomId} placeholder="Course ID from teacher Host panel" onSubmitEditing={connectByHost} />
        <Button title="Connect" onPress={connectByHost} />
        <Input value={packageText} onChangeText={setPackageText} placeholder="Paste teacher offline package JSON" multiline />
        <Button tone="muted" title="Import Offline Package" onPress={importPackage} />
        <Text>{connectMessage}</Text>
      </Card>
      <Title>Course Section</Title>
      <View style={styles.grid}>
        {classrooms.length ? classrooms.map(room => (
          <Pressable key={room.id} style={styles.card} onPress={() => onOpen(room)}>
            <Title>{room.name}</Title>
          </Pressable>
        )) : <Card><Title>No Courses Available</Title><Text>Enter a classroom key above.</Text></Card>}
      </View>
    </View>
  );
}

function TeacherDashboard({ user, classrooms, onCreated, onOpen }) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  async function create() {
    const result = await createClassroom(user.id, name, key);
    setMessage(result.ok ? `Classroom created: ${result.classroom.enrollmentKey}` : result.message);
    if (result.ok) {
      setName("");
      setKey("");
      onCreated();
    }
  }
  return (
    <View>
      <Title>Welcome {user.name}</Title>
      <Card>
        <Title>Create New Classroom</Title>
        <Input value={name} onChangeText={setName} placeholder="Classroom Name" />
        <Input value={key} onChangeText={setKey} placeholder="Classroom Key" onSubmitEditing={create} />
        <Button title="Create Classroom" onPress={create} />
        <Text>{message}</Text>
      </Card>
      <View style={styles.grid4}>
        {classrooms.map(room => (
          <Pressable key={room.id} style={styles.card} onPress={() => onOpen(room)}>
            <Title>{room.name}</Title>
            <Text>Key: {room.enrollmentKey}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function TeacherClassroom({ classroom, tab, setTab, onPendingChange }) {
  return (
    <View>
      <Title>{classroom.name}</Title>
      <TeacherHostPanel classroom={classroom} onPendingChange={onPendingChange} />
      <Tabs tab={tab} setTab={setTab} tabs={["resources", "participants", "grades"]} />
      {tab === "resources" && <TeacherResources classroom={classroom} />}
      {tab === "participants" && <Participants classroom={classroom} />}
      {tab === "grades" && <Grades classroom={classroom} editable />}
    </View>
  );
}

function TeacherHostPanel({ classroom, onPendingChange }) {
  const [packageText, setPackageText] = useState("");
  const [localHostUrl, setLocalHostUrl] = useState("http://localhost:10000");
  const [hostMessage, setHostMessage] = useState("");
  const defaultHost = "http://YOUR-HOTSPOT-IP:10000";
  async function hostClassroom() {
    const payload = await getClassroomOfflinePackage(classroom.id);
    setPackageText(JSON.stringify(payload));
    try {
      await publishClassroomToTeacherHost(localHostUrl, classroom.id, payload);
      setHostMessage(`Hosting package ready on ${localHostUrl}. Course ID: ${classroom.id}. Students can connect on the hotspot Wi-Fi using the teacher device IP.`);
    } catch (_error) {
      setHostMessage(`Package ready. Start the local backend or share the package JSON. Course ID: ${classroom.id}.`);
    }
    onPendingChange?.();
  }
  async function sync() {
    const result = await syncPendingWrites();
    setHostMessage(result.pending ? `${result.pending} records still waiting for internet.` : "All offline classroom data is synced.");
    onPendingChange?.();
  }
  return (
    <Card>
      <Title>Offline Host</Title>
      <Text>Turn on the teacher device hotspot, run the backend on that device, then share the LAN URL with students.</Text>
      <Text>Student URL: {defaultHost} | Course ID: {classroom.id}</Text>
      <Input value={localHostUrl} onChangeText={setLocalHostUrl} placeholder="Local backend URL on teacher device" />
      <View style={styles.tabs}>
        <Button title="Host" onPress={hostClassroom} />
        <Button tone="muted" title="Sync When Online" onPress={sync} />
      </View>
      {!!packageText && <Input value={packageText} onChangeText={setPackageText} multiline />}
      <Text>{hostMessage}</Text>
    </Card>
  );
}

function StudentClassroom({ classroom, tab, setTab, user }) {
  return (
    <View>
      <Title>{classroom.name}</Title>
      <Tabs tab={tab} setTab={setTab} tabs={["resources", "grades"]} />
      {tab === "resources" && <StudentResources classroom={classroom} user={user} />}
      {tab === "grades" && <Grades classroom={classroom} student={user} />}
    </View>
  );
}

function Tabs({ tab, setTab, tabs }) {
  return <View style={styles.tabs}>{tabs.map(item => <Button key={item} tone={tab === item ? "primary" : "muted"} title={item[0].toUpperCase() + item.slice(1)} onPress={() => setTab(item)} />)}</View>;
}

async function readPickedFileDataUrl(file) {
  if (!file?.uri || typeof FileReader === "undefined") return "";
  try {
    const response = await fetch(file.uri);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = event => resolve(event.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (_error) {
    return "";
  }
}

function TeacherResources({ classroom }) {
  const [sections, setSections] = useState([]);
  const [sectionName, setSectionName] = useState("");
  async function refresh() {
    setSections(await listSections(classroom.id));
  }
  useEffect(() => { refresh(); }, [classroom.id]);
  async function create() {
    if (!sectionName.trim()) return;
    await createSection(classroom.id, sectionName.trim());
    setSectionName("");
    refresh();
  }
  return (
    <View>
      <Card>
        <Input value={sectionName} onChangeText={setSectionName} placeholder="Section Name" onSubmitEditing={create} />
        <Button title="Create Section" onPress={create} />
      </Card>
      {sections.map(section => <SectionEditor key={section.id} classroom={classroom} section={section} />)}
    </View>
  );
}

function SectionEditor({ classroom, section }) {
  const [resources, setResources] = useState([]);
  const [quizzes, setQuizzes] = useState([]);
  const [resourceTitle, setResourceTitle] = useState("");
  const [quizTitle, setQuizTitle] = useState("");
  const [timer, setTimer] = useState("10");
  async function refresh() {
    setResources(await listResources(classroom.id, section.id));
    setQuizzes(await listQuizzes(classroom.id, section.id));
  }
  useEffect(() => { refresh(); }, [section.id]);
  async function pickFile() {
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (picked.canceled) return;
    const file = picked.assets[0];
    const fileDataUrl = await readPickedFileDataUrl(file);
    await saveResource(classroom.id, section.id, {
      title: resourceTitle || file.name,
      fileName: file.name,
      fileType: file.mimeType || "unknown",
      fileSize: file.size || 0,
      fileUri: file.uri,
      fileDataUrl
    });
    setResourceTitle("");
    refresh();
  }
  async function makeQuiz() {
    if (!quizTitle.trim()) return;
    await createQuiz(classroom.id, section.id, { title: quizTitle.trim(), timerMinutes: Number(timer) || 10 });
    setQuizTitle("");
    refresh();
  }
  return (
    <Card>
      <Title>{section.name}</Title>
      <Input value={resourceTitle} onChangeText={setResourceTitle} placeholder="Resource Title" />
      <Button title="Upload Resource From Device" onPress={pickFile} />
      {resources.map(item => <Text key={item.id}>Resource: {item.title} ({item.fileName})</Text>)}
      <Input value={quizTitle} onChangeText={setQuizTitle} placeholder="Quiz Title" />
      <Input value={timer} onChangeText={setTimer} placeholder="Timer Minutes" keyboardType="numeric" onSubmitEditing={makeQuiz} />
      <Button title="Create Quiz" onPress={makeQuiz} />
      {quizzes.map(quiz => <QuizEditor key={quiz.id} classroom={classroom} section={section} quiz={quiz} refresh={refresh} />)}
    </Card>
  );
}

function QuizEditor({ classroom, section, quiz, refresh }) {
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState(["", "", "", ""]);
  const [correctIndex, setCorrectIndex] = useState(0);
  const [questionImageDataUrl, setQuestionImageDataUrl] = useState("");
  async function addQuestion() {
    const nextQuestions = [...(quiz.questions || []), { id: Date.now(), text: question, answers, correctIndex, imageDataUrl: questionImageDataUrl }];
    await updateQuiz(classroom.id, section.id, quiz.id, { questions: nextQuestions });
    setQuestion("");
    setAnswers(["", "", "", ""]);
    setQuestionImageDataUrl("");
    refresh();
  }
  async function pickQuestionImage() {
    const picked = await DocumentPicker.getDocumentAsync({ type: "image/*", copyToCacheDirectory: true });
    if (picked.canceled) return;
    setQuestionImageDataUrl(await readPickedFileDataUrl(picked.assets[0]));
  }
  async function publish() {
    await updateQuiz(classroom.id, section.id, quiz.id, { published: true });
    refresh();
  }
  return (
    <Card>
      <Text style={styles.heading}>{quiz.title} - {quiz.published ? "Published" : "Draft"}</Text>
      <Text>{(quiz.questions || []).length} questions</Text>
      {!quiz.published && (
        <>
          <Input value={question} onChangeText={setQuestion} placeholder="Question" />
          <Button tone="muted" title={questionImageDataUrl ? "Question Image Added" : "Add Question Image"} onPress={pickQuestionImage} />
          {answers.map((answer, index) => <Input key={index} value={answer} onChangeText={value => {
            const copy = [...answers];
            copy[index] = value;
            setAnswers(copy);
          }} placeholder={`Answer ${index + 1}`} />)}
          <Input value={String(correctIndex + 1)} onChangeText={value => setCorrectIndex(Math.max(0, Number(value) - 1))} placeholder="Correct Answer Number 1-4" keyboardType="numeric" />
          <Button title="Add Question" onPress={addQuestion} />
          <Button title="Publish Quiz" onPress={publish} />
        </>
      )}
      {(quiz.questions || []).map(item => (
        <Card key={item.id || item.text}>
          <Text style={styles.heading}>{item.text}</Text>
          {!!item.imageDataUrl && <Text>Image attached</Text>}
          <Text>Answers: {(item.answers || []).join(", ")}</Text>
          <Text>Correct Answer: {item.answers?.[item.correctIndex]}</Text>
        </Card>
      ))}
    </Card>
  );
}

function StudentResources({ classroom, user }) {
  const [sections, setSections] = useState([]);
  const [activeQuiz, setActiveQuiz] = useState(null);
  const [activeResource, setActiveResource] = useState(null);
  useEffect(() => {
    listSections(classroom.id).then(async items => {
      const detailed = [];
      for (const section of items) {
        detailed.push({
          ...section,
          resources: await listResources(classroom.id, section.id),
          quizzes: (await listQuizzes(classroom.id, section.id)).filter(item => item.published)
        });
      }
      setSections(detailed);
    });
  }, [classroom.id]);
  if (activeQuiz) return <TakeQuiz classroom={classroom} quiz={activeQuiz} user={user} onDone={() => setActiveQuiz(null)} />;
  if (activeResource) return <ResourceViewer resource={activeResource} onBack={() => setActiveResource(null)} />;
  return (
    <View>
      {sections.map(section => (
        <Card key={section.id}>
          <Title>{section.name}</Title>
          {section.resources.length ? section.resources.map(item => (
            <Pressable key={item.id} style={styles.progressCard} onPress={() => setActiveResource(item)}>
              <Text style={styles.heading}>{item.title}</Text>
              <Text>File: {item.fileName}</Text>
              <Text>Size: {formatFileSize(item.fileSize || 0)}</Text>
            </Pressable>
          )) : <Text>No files in this section yet.</Text>}
          {section.quizzes.map(quiz => <Button key={quiz.id} title={`Quiz: ${quiz.title}`} onPress={() => setActiveQuiz(quiz)} />)}
        </Card>
      ))}
    </View>
  );
}

function ResourceViewer({ resource, onBack }) {
  return (
    <Card>
      <Title>{resource.title}</Title>
      {resource.fileDataUrl ? (
        <>
          <Text>Preview ready offline: {resource.fileName}</Text>
          {resource.fileType?.startsWith("image/") ? (
            <Image source={{ uri: resource.fileDataUrl }} style={styles.resourceImage} resizeMode="contain" />
          ) : (
            <Text>Video, audio, PDF, and document files are saved with the course package for offline access. Native preview/download handling can be connected during the APK build step.</Text>
          )}
        </>
      ) : (
        <Text>This file is listed offline, but preview data is not stored on this device yet. Ask the teacher to host or re-upload it while students are connected.</Text>
      )}
      <Button tone="muted" title="Back To Classroom" onPress={onBack} />
    </Card>
  );
}

function formatFileSize(bytes) {
  if (!bytes) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function TakeQuiz({ classroom, quiz, user, onDone }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [seconds, setSeconds] = useState((quiz.timerMinutes || 10) * 60);
  const question = quiz.questions[index];
  const submit = async () => {
    const score = quiz.questions.reduce((total, item, idx) => total + (answers[idx] === item.correctIndex ? 1 : 0), 0);
    const value = `${score}/${quiz.questions.length}`;
    await saveGrade(classroom.id, user.id, quiz.title, value);
    if (classroom.teacherHostUrl) {
      await submitGradeToTeacherHost(classroom.teacherHostUrl, classroom.id, {
        id: `${user.id}_${quiz.title}`,
        studentId: user.id,
        studentName: user.name,
        columnName: quiz.title,
        value,
        updatedAt: Date.now()
      }).catch(() => {});
    }
    Alert.alert("Quiz Submitted", `Score: ${score}/${quiz.questions.length}`);
    onDone();
  };
  useEffect(() => {
    const timer = setInterval(() => setSeconds(value => {
      if (value <= 1) {
        clearInterval(timer);
        submit();
        return 0;
      }
      return value - 1;
    }), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Card>
      <Title>{quiz.title}</Title>
      <Text>Time Left: {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</Text>
      <Text style={styles.question}>Question {index + 1}: {question.text}</Text>
      {question.answers.map((answer, answerIndex) => (
        <Pressable key={answerIndex} style={[styles.choice, answers[index] === answerIndex && styles.choiceSelected]} onPress={() => setAnswers({ ...answers, [index]: answerIndex })}>
          <Text>{answerIndex + 1}. {answer}</Text>
        </Pressable>
      ))}
      <View style={styles.tabs}>
        {index > 0 && <Button title="Previous" onPress={() => setIndex(index - 1)} />}
        {index < quiz.questions.length - 1 && <Button title="Next" onPress={() => setIndex(index + 1)} />}
        {index === quiz.questions.length - 1 && <Button title="Submit Quiz" onPress={submit} />}
      </View>
    </Card>
  );
}

function Participants({ classroom }) {
  const [participants, setParticipants] = useState([]);
  async function refresh() {
    setParticipants(await listParticipants(classroom.id));
  }
  useEffect(() => { refresh(); }, [classroom.id]);
  return (
    <Card>
      <Title>Participants</Title>
      {participants.map(item => <View key={item.id} style={styles.row}><Text>{item.name} - {item.email}</Text><Button tone="danger" title="Remove" onPress={async () => { await removeParticipant(classroom.id, item.id); refresh(); }} /></View>)}
    </Card>
  );
}

function Grades({ classroom, student, editable }) {
  const [grades, setGrades] = useState([]);
  const [columns, setColumns] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [newColumnName, setNewColumnName] = useState("");
  async function refresh() {
    const [nextGrades, nextColumns, nextParticipants] = await Promise.all([
      listGrades(classroom.id),
      listGradeColumns(classroom.id),
      listParticipants(classroom.id)
    ]);
    const derivedColumns = nextColumns.length
      ? nextColumns
      : Array.from(new Set(nextGrades.map(item => item.columnName).filter(Boolean))).map(name => ({ id: name, classroomId: classroom.id, name }));
    setGrades(nextGrades);
    setColumns(derivedColumns);
    setParticipants(nextParticipants);
  }
  useEffect(() => { refresh(); }, [classroom.id]);
  async function addColumn() {
    if (!newColumnName.trim()) return;
    await createGradeColumn(classroom.id, newColumnName.trim());
    setNewColumnName("");
    refresh();
  }
  async function renameColumn(column, name) {
    if (!name.trim()) return;
    await updateGradeColumn(classroom.id, column.id, { name: name.trim() });
    refresh();
  }
  async function removeColumn(column) {
    await deleteGradeColumn(classroom.id, column.id);
    refresh();
  }
  async function updateCell(participant, column, value) {
    await saveGradeCell(classroom.id, participant.studentId || participant.id, column.id, column.name, value);
    refresh();
  }
  const visibleParticipants = student ? [{ id: student.id, studentId: student.id, name: student.name, email: student.email }] : participants;
  return (
    <Card>
      <Title>Grades</Title>
      {editable && (
        <View style={styles.sectionTools}>
          <Input value={newColumnName} onChangeText={setNewColumnName} placeholder="Column Name" onSubmitEditing={addColumn} />
          <Button title="Add Column" onPress={addColumn} />
        </View>
      )}
      {!columns.length ? (
        <Text>{editable ? "Add grade columns for assignments, quizzes, or manual marks." : "No grades available yet."}</Text>
      ) : (
        <ScrollView horizontal style={styles.tableWrap}>
          <View>
            <View style={styles.tableRow}>
              <Text style={[styles.tableCell, styles.tableHeader]}>Participant</Text>
              {columns.map(column => (
                <View key={column.id} style={[styles.tableCell, styles.tableHeader, styles.gradeColumnHeader]}>
                  {editable ? (
                    <>
                      <Input value={column.name} onChangeText={value => setColumns(items => items.map(item => item.id === column.id ? { ...item, name: value } : item))} />
                      <View style={styles.tableActions}>
                        <Button title="Save" onPress={() => renameColumn(column, column.name)} />
                        <Button tone="danger" title="Delete" onPress={() => removeColumn(column)} />
                      </View>
                    </>
                  ) : <Text style={styles.tableHeaderText}>{column.name}</Text>}
                </View>
              ))}
            </View>
            {visibleParticipants.map(participant => (
              <View key={participant.studentId || participant.id} style={styles.tableRow}>
                <Text style={styles.tableCell}>{participant.name}</Text>
                {columns.map(column => {
                  const grade = grades.find(item => item.studentId === (participant.studentId || participant.id) && (item.columnId === column.id || item.columnName === column.name));
                  return (
                    <View key={column.id} style={styles.tableCell}>
                      {editable ? (
                        <Input value={grade?.value || ""} onChangeText={value => updateCell(participant, column, value)} />
                      ) : <Text>{grade?.value || ""}</Text>}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
      {editable && <Text>Quiz grades update automatically when students submit, and manual edits are saved offline if internet is unavailable.</Text>}
    </Card>
  );
}

function Card({ children, tone }) {
  return <View style={[styles.card, tone === "glass" && styles.glassCard]}>{children}</View>;
}

function Title({ children, light }) {
  return <Text style={[styles.title, light && styles.lightTitle]}>{children}</Text>;
}

function Input(props) {
  return <TextInput {...props} style={styles.input} placeholderTextColor="#64748b" />;
}

function Button({ title, onPress, tone = "primary" }) {
  return <Pressable style={[styles.button, tone === "muted" && styles.buttonMuted, tone === "danger" && styles.buttonDanger, tone === "light" && styles.buttonLight, tone === "outline" && styles.buttonOutline]} onPress={onPress}>
    <Text style={[styles.buttonText, tone === "light" && styles.buttonLightText]}>{title}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  page: { backgroundColor: "#eef2f6" },
  content: { padding: 20, gap: 22, width: "100%", maxWidth: 1180, alignSelf: "center" },
  nav: { backgroundColor: "#0f172a", borderRadius: 10, padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, boxShadow: "0 10px 28px rgba(15,23,42,0.18)" },
  logo: { color: "#38bdf8", fontSize: 28, fontWeight: "900" },
  navLinks: { flexDirection: "row", gap: 18, flexWrap: "wrap" },
  navLink: { color: "white", fontWeight: "700" },
  statusPill: { color: "#dbeafe", fontWeight: "800" },
  hero: { backgroundColor: "#123a5f", borderRadius: 12, padding: 36, gap: 28, boxShadow: "0 22px 55px rgba(15,23,42,0.22)" },
  heroTitle: { color: "white", fontSize: 54, fontWeight: "900", textAlign: "center" },
  heroSubtitle: { color: "#67e8f9", fontSize: 23, fontWeight: "800", textAlign: "center" },
  heroText: { color: "#dbeafe", fontSize: 18, lineHeight: 28, textAlign: "center", maxWidth: 860, alignSelf: "center" },
  loginSelection: { flexDirection: "row", flexWrap: "wrap", gap: 18 },
  glassCard: { backgroundColor: "rgba(255,255,255,0.10)", borderColor: "rgba(255,255,255,0.24)" },
  loginIcon: { color: "#0f172a", backgroundColor: "#e0f2fe", width: 54, height: 54, borderRadius: 8, textAlign: "center", lineHeight: 54, fontWeight: "900" },
  featureIcon: { color: "#0f172a", backgroundColor: "#e0f2fe", alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, fontWeight: "900", overflow: "hidden" },
  lightText: { color: "#e2e8f0", lineHeight: 24 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 18 },
  grid4: { flexDirection: "row", flexWrap: "wrap", gap: 18 },
  card: { backgroundColor: "white", borderColor: "#d8e0ea", borderWidth: 1, borderRadius: 8, padding: 22, gap: 12, flexGrow: 1, flexBasis: 260, boxShadow: "0 8px 22px rgba(15,23,42,0.07)" },
  title: { color: "#155e75", fontSize: 24, fontWeight: "900" },
  lightTitle: { color: "white" },
  heading: { color: "#0f172a", fontSize: 18, fontWeight: "800", marginTop: 10 },
  input: { borderColor: "#cbd5e1", borderWidth: 1, borderRadius: 8, padding: 14, fontSize: 16, backgroundColor: "white" },
  button: { backgroundColor: "#155e75", borderRadius: 8, padding: 14, alignItems: "center", marginTop: 4 },
  buttonMuted: { backgroundColor: "#475569" },
  buttonDanger: { backgroundColor: "#dc2626" },
  buttonLight: { backgroundColor: "white" },
  buttonOutline: { backgroundColor: "transparent", borderColor: "white", borderWidth: 2 },
  buttonText: { color: "white", fontWeight: "800" },
  buttonLightText: { color: "#2563eb" },
  error: { color: "#ef4444", fontWeight: "700" },
  tabs: { flexDirection: "row", gap: 10, flexWrap: "wrap", marginVertical: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  progressCard: { backgroundColor: "#f8fafc", borderColor: "#d8e0ea", borderWidth: 1, borderRadius: 8, padding: 18, gap: 8 },
  sectionTools: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  tableWrap: { backgroundColor: "white", borderRadius: 8, borderColor: "#d8e0ea", borderWidth: 1 },
  tableRow: { flexDirection: "row", alignItems: "stretch" },
  tableCell: { width: 190, minHeight: 58, padding: 12, borderBottomColor: "#e2e8f0", borderBottomWidth: 1, borderRightColor: "#e2e8f0", borderRightWidth: 1, justifyContent: "center" },
  tableHeader: { backgroundColor: "#f8fafc" },
  tableHeaderText: { color: "#2563eb", fontWeight: "800" },
  gradeColumnHeader: { gap: 8 },
  tableActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  resourceImage: { width: "100%", height: 420, backgroundColor: "#f8fafc", borderRadius: 14 },
  question: { fontSize: 22, fontWeight: "900", color: "#0f172a", lineHeight: 32 },
  choice: { borderColor: "#e2e8f0", borderWidth: 1, borderRadius: 12, padding: 14, backgroundColor: "#f8fafc" },
  choiceSelected: { borderColor: "#2563eb", backgroundColor: "#eff6ff" }
});
