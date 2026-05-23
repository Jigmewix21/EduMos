import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
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
  deleteGrade,
  deleteGradeColumn,
  deleteQuiz,
  deleteResource,
  deleteSection,
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
import { getOfflineStore, getPendingWriteCount, isOnline, listenForOnline, setOfflineStore } from "./offlineStore";

const DEFAULT_STUDENT = { email: "student1@gmail.com", password: "student123" };
const DEFAULT_TEACHER = { email: "teacher@edumos.com", password: "teacher123" };
const SCREEN_ROUTES = new Set(["home", "about", "login", "signup", "studentSetup", "studentDashboard", "studentClassroom", "teacherDashboard", "teacherClassroom"]);
const userKey = (role, email) => `${role}__${email.trim().toLowerCase()}`;
const logoImage = require("../assets/edumos-logo.jpeg");

function routeForScreen(nextScreen) {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  if (nextScreen === "home") {
    url.searchParams.delete("screen");
  } else {
    url.searchParams.set("screen", nextScreen);
  }
  return url.pathname + url.search + url.hash;
}

function initialScreen() {
  if (typeof window === "undefined") return "home";
  const fromState = window.history?.state?.edumosScreen;
  const fromUrl = new URL(window.location.href).searchParams.get("screen");
  const nextScreen = fromState || fromUrl;
  return SCREEN_ROUTES.has(nextScreen) ? nextScreen : "home";
}

export default function App() {
  const { width } = useWindowDimensions();
  const compact = width < 720;
  const [screen, setScreen] = useState(initialScreen);
  const screenRef = useRef(screen);
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

  const navigate = useCallback((nextScreen, options = {}) => {
    if (!SCREEN_ROUTES.has(nextScreen)) return;
    screenRef.current = nextScreen;
    setScreen(nextScreen);
    if (typeof window !== "undefined" && window.history) {
      const nextRoute = routeForScreen(nextScreen);
      const state = { ...(window.history.state || {}), edumosScreen: nextScreen };
      if (options.replace) {
        window.history.replaceState(state, "", nextRoute);
      } else {
        window.history.pushState(state, "", nextRoute);
      }
    }
  }, []);

  const parentScreen = useCallback((currentScreen = screenRef.current) => {
    if (currentScreen === "studentClassroom") return "studentDashboard";
    if (currentScreen === "teacherClassroom") return "teacherDashboard";
    if (currentScreen === "about" || currentScreen === "login" || currentScreen === "signup") return "home";
    if (currentScreen === "studentDashboard" || currentScreen === "teacherDashboard") return "home";
    return null;
  }, []);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.history) return undefined;
    const currentState = window.history.state || {};
    if (!currentState.edumosScreen) {
      window.history.replaceState({ ...currentState, edumosScreen: screenRef.current }, "", routeForScreen(screenRef.current));
    }
    const onPopState = event => {
      const nextScreen = event.state?.edumosScreen || "home";
      if (SCREEN_ROUTES.has(nextScreen)) {
        screenRef.current = nextScreen;
        setScreen(nextScreen);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const session = getOfflineStore().activeSession;
    if (!session?.user || !session?.role) return;
    setUser(session.user);
    setRole(session.role);
    if (screenRef.current === "home") {
      navigate(session.role === "teacher" ? "teacherDashboard" : "studentDashboard", { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    if (!BackHandler?.addEventListener) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      const previous = parentScreen();
      if (!previous) return false;
      navigate(previous, { replace: true });
      return true;
    });
    return () => subscription.remove();
  }, [navigate, parentScreen]);

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
    setOfflineStore(store => ({ ...store, activeSession: { role: nextRole, user: found, savedAt: Date.now() } }));
    navigate(nextRole === "teacher" ? "teacherDashboard" : "studentDashboard");
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

  useEffect(() => {
    const needsUser = ["studentDashboard", "studentClassroom", "teacherDashboard", "teacherClassroom"].includes(screen);
    if (needsUser && !user) {
      navigate("home", { replace: true });
      return;
    }
    if (screen === "studentClassroom" && !activeClassroom) {
      navigate("studentDashboard", { replace: true });
    }
    if (screen === "teacherClassroom" && !activeClassroom) {
      navigate("teacherDashboard", { replace: true });
    }
  }, [activeClassroom, navigate, screen, user]);

  function logout() {
    setOfflineStore(store => ({ ...store, activeSession: null }));
    setUser(null);
    setActiveClassroom(null);
    navigate("home", { replace: true });
  }

  function createLocalStudentProfile(name, profileEmail, profilePassword) {
    const cleanName = name.trim();
    const cleanEmail = profileEmail.trim().toLowerCase();
    const cleanPassword = profilePassword.trim();
    if (!cleanName || !cleanEmail || !cleanPassword) {
      setMessage("Add your name, education email, and password first.");
      return;
    }
    const student = {
      id: `student_${cleanEmail.replace(/[^a-z0-9]/g, "_")}`,
      name: cleanName,
      email: cleanEmail,
      password: cleanPassword,
      role: "student",
      localOnly: true,
      createdAt: Date.now()
    };
    setOfflineStore(store => ({
      ...store,
      users: { ...(store.users || {}), [userKey("student", cleanEmail)]: student },
      activeSession: { role: "student", user: student, savedAt: Date.now() }
    }));
    setUser(student);
    setRole("student");
    setMessage("");
    navigate("studentDashboard");
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={[styles.content, compact && styles.contentCompact]}>
      <Header compact={compact} onHome={() => navigate("home")} onAbout={() => navigate("about")} onLogout={user ? logout : null} online={online} pendingWrites={pendingWrites} onSync={syncNow} />
      {screen === "home" && <Home compact={compact} setScreen={navigate} setRole={setRole} setEmail={setEmail} setPassword={setPassword} />}
      {screen === "about" && <About />}
      {screen === "studentSetup" && <StudentSetup onCreate={createLocalStudentProfile} message={message} />}
      {screen === "login" && (
        <AuthShell
          title={role === "teacher" ? "Teacher Login" : "Student Login"}
          subtitle={role === "teacher" ? "Manage courses, hotspot hosting, quizzes, and offline sync." : "Access courses, resources, quizzes, and grades online or offline."}
        >
          <Input value={email} onChangeText={setEmail} placeholder="Email" onSubmitEditing={() => login(role)} keyboardType="email-address" autoCapitalize="none" />
          <Input value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry onSubmitEditing={() => login(role)} />
          <Button title="Login" onPress={() => login(role)} />
          {role === "teacher" && <Button tone="muted" title="Create Teacher Account" onPress={() => navigate("signup")} />}
          {!!message && <Text style={styles.error}>{message}</Text>}
        </AuthShell>
      )}
      {screen === "signup" && <TeacherSignup onDone={() => navigate("login")} />}
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
            navigate("studentClassroom");
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
            navigate("teacherClassroom");
          }}
        />
      )}
      {screen === "teacherClassroom" && activeClassroom && (
        <TeacherClassroom classroom={activeClassroom} tab={tab} setTab={setTab} onPendingChange={() => setPendingWrites(getPendingWriteCount())} />
      )}
    </ScrollView>
  );
}

function Header({ compact, onHome, onAbout, onLogout, online, pendingWrites, onSync }) {
  return (
    <View style={[styles.nav, compact && styles.navCompact]}>
      <Pressable accessibilityRole="button" focusable tabIndex={0} onKeyDown={event => activateByKeyboard(event, onHome)} onPress={onHome} style={({ hovered, focused }) => [styles.brandLockup, (hovered || focused) && styles.brandLockupFocus]}>
        <Image source={logoImage} style={styles.brandLogoImage} resizeMode="cover" />
        <Text style={styles.logo}>EduMos</Text>
      </Pressable>
      <View style={[styles.navLinks, compact && styles.navLinksCompact]}>
        <Text style={[styles.statusPill, !online && styles.statusPillOffline]}>{online ? "Online" : "Offline"} | {pendingWrites} waiting</Text>
        {pendingWrites > 0 && <NavButton title="Sync" onPress={onSync} />}
        <NavButton title="Home" onPress={onHome} />
        <NavButton title="About Us" onPress={onAbout} />
        {onLogout && <NavButton title="Logout" onPress={onLogout} />}
      </View>
    </View>
  );
}

function activateByKeyboard(event, onPress) {
  const key = event?.nativeEvent?.key || event?.key;
  if ((key === "Enter" || key === " ") && onPress) {
    event.preventDefault?.();
    onPress(event);
  }
}

async function openDeviceSetting(action) {
  try {
    if (Platform.OS === "android" && Linking.sendIntent) {
      await Linking.sendIntent(action);
      return;
    }
    await Linking.openSettings();
  } catch (_error) {
    Alert.alert("Open Settings", "Please open your phone settings and turn on Wi-Fi or hotspot manually.");
  }
}

function NavButton({ title, onPress }) {
  return (
    <Pressable accessibilityRole="button" focusable tabIndex={0} onKeyDown={event => activateByKeyboard(event, onPress)} onPress={onPress} style={({ hovered, focused }) => [styles.navButton, (hovered || focused) && styles.navButtonFocus]}>
      <Text style={styles.navLink}>{title}</Text>
    </Pressable>
  );
}

function Home({ compact, setScreen, setRole, setEmail, setPassword }) {
  function openLogin(nextRole) {
    if (nextRole === "student") {
      const session = getOfflineStore().activeSession;
      if (session?.role === "student" && session.user) {
        setScreen("studentDashboard");
        return;
      }
      setScreen("studentSetup");
      return;
    }
    const session = getOfflineStore().activeSession;
    if (session?.role === "teacher" && session.user) {
      setScreen("teacherDashboard");
      return;
    }
    setRole(nextRole);
    setEmail(nextRole === "teacher" ? DEFAULT_TEACHER.email : DEFAULT_STUDENT.email);
    setPassword(nextRole === "teacher" ? DEFAULT_TEACHER.password : DEFAULT_STUDENT.password);
    setScreen("login");
  }
  return (
    <View>
      <View style={[styles.hero, compact && styles.heroCompact]}>
        <View style={styles.heroShapes}>
          <View style={[styles.shape, styles.shapeBlue]} />
          <View style={[styles.shape, styles.shapeGreen]} />
          <View style={[styles.shape, styles.shapeMint]} />
          <View style={[styles.shape, styles.shapeSoft]} />
        </View>
        <View style={styles.heroCenter}>
          <Image source={logoImage} style={[styles.heroLogoImage, compact && styles.heroLogoImageCompact]} resizeMode="contain" />
          <Text style={[styles.heroTitle, compact && styles.heroTitleCompact]}>EduMos</Text>
          <Text style={styles.heroSubtitle}>
            A smart learning platform for students and teachers.
          </Text>
          <Text style={styles.heroText}>Learn. Teach. Grow.</Text>
          <View style={styles.heroActions}>
            <Button tone="start" title="Student" onPress={() => openLogin("student")} />
            <Button tone="heroOutline" title="Teacher" onPress={() => openLogin("teacher")} />
          </View>
        </View>
      </View>
      <View style={styles.loginSelection}>
        <Card tone="glass">
          <Title>Student Portal</Title>
          <Text style={styles.bodyText}>Create a free offline profile, join a teacher hotspot group, and keep downloaded resources on this device.</Text>
          <Button title="Open Student" onPress={() => openLogin("student")} />
        </Card>
        <Card tone="glass">
          <Title>Teacher Portal</Title>
          <Text style={styles.bodyText}>Log in once online, then open your dashboard offline, host classrooms, and share resources locally.</Text>
          <Button tone="muted" title="Open Teacher" onPress={() => openLogin("teacher")} />
        </Card>
      </View>
      <Title>What We Offer</Title>
      <View style={styles.grid}>
        <Feature title="Offline Access" text="Students can open downloaded course resources and quizzes without internet." />
        <Feature title="Hotspot Sharing" text="Teachers host course packages locally so students connect on Wi-Fi or hotspot." />
        <Feature title="Smart Sync" text="Quiz submissions and gradebook data wait offline, then sync when internet returns." />
      </View>
      <View style={styles.statsBand}>
        <Stat value="500+" label="Students" />
        <Stat value="50+" label="Teachers" />
        <Stat value="100+" label="Lessons" />
        <Stat value="12" label="Schools Reached" />
      </View>
      <Title>How It Works</Title>
      <View style={styles.howGrid}>
        <HowStep number="01" title="Download Content" text="Teacher prepares lessons, notes, resources, and quizzes while connected." />
        <HowStep number="02" title="Share Locally" text="Students connect to the teacher hotspot and receive the classroom package." />
        <HowStep number="03" title="Sync Progress" text="Quiz results and grade updates sync automatically when internet returns." />
      </View>
      <OfflineSection />
    </View>
  );
}

function Feature({ title, text }) {
  return <Card tone="soft"><Title>{title}</Title><Text style={styles.bodyText}>{text}</Text></Card>;
}

function Stat({ value, label }) {
  return (
    <View style={styles.statCounter}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function HowStep({ number, title, text }) {
  return (
    <View style={styles.howStep}>
      <Text style={styles.howNumber}>{number}</Text>
      <Text style={styles.howTitle}>{title}</Text>
      <Text style={styles.bodyText}>{text}</Text>
    </View>
  );
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
      <Feature title="Classroom Keys" text="Students join the correct teacher course with a simple enrollment key." />
      <Feature title="Interactive Quizzes" text="Teachers publish timed quizzes and students can submit them offline." />
      <Feature title="Resource Library" text="Sections keep notes, PDFs, images, audio, and videos organized by lesson." />
    </View>
    </View>
  );
}

function AuthShell({ title, subtitle, children }) {
  return (
    <View style={styles.authShell}>
      <View style={styles.authShapes}>
        <View style={[styles.shape, styles.authShapeBlue]} />
        <View style={[styles.shape, styles.authShapeGreen]} />
      </View>
      <View style={styles.authPanel}>
        <Text style={styles.authBrand}>EduMos</Text>
        <Title>{title}</Title>
        <Text style={styles.bodyText}>{subtitle}</Text>
        {children}
      </View>
    </View>
  );
}

function StudentSetup({ onCreate, message }) {
  const [name, setName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profilePassword, setProfilePassword] = useState("");
  return (
    <AuthShell title="Student Profile" subtitle="This profile is free and works without internet. Your downloaded classroom resources stay saved on this device.">
      <Input value={name} onChangeText={setName} placeholder="Student Name" />
      <Input value={profileEmail} onChangeText={setProfileEmail} placeholder="Education Email" keyboardType="email-address" autoCapitalize="none" />
      <Input value={profilePassword} onChangeText={setProfilePassword} placeholder="Password" secureTextEntry onSubmitEditing={() => onCreate(name, profileEmail, profilePassword)} />
      <Button title="Continue Offline" onPress={() => onCreate(name, profileEmail, profilePassword)} />
      {!!message && <Text style={styles.error}>{message}</Text>}
    </AuthShell>
  );
}

function TeacherSignup({ onDone }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  return (
    <AuthShell title="Teacher Sign Up" subtitle="Create a teacher account once online, then continue preparing classrooms offline.">
      <Input value={name} onChangeText={setName} placeholder="Full Name" />
      <Input value={email} onChangeText={setEmail} placeholder="Email" keyboardType="email-address" autoCapitalize="none" />
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
      {!!message && <Text style={styles.error}>{message}</Text>}
    </AuthShell>
  );
}

function StudentDashboard({ user, classrooms, onEnroll, onConnected, onOpen, message }) {
  const [key, setKey] = useState("");
  return (
    <View>
      <Title>Welcome {user.name}</Title>
      <View style={styles.summaryBand}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Profile</Text>
          <Text style={styles.summaryValue}>{user.name}</Text>
          <Text style={styles.summaryMeta}>{user.email}</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Saved Courses</Text>
          <Text style={styles.summaryValue}>{classrooms.length}</Text>
          <Text style={styles.summaryMeta}>available offline</Text>
        </View>
      </View>
      <StudentJoinPanel user={user} onConnected={onConnected} />
      <Card tone="soft">
        <Title>Have A Classroom Key?</Title>
        <Text style={styles.bodyText}>Use this when your teacher gives you an enrollment key instead of hotspot sharing.</Text>
        <View style={styles.sectionTools}>
          <Input value={key} onChangeText={setKey} placeholder="Enter classroom key" onSubmitEditing={() => onEnroll(key)} />
          <Button title="Join With Key" onPress={() => onEnroll(key)} />
        </View>
        {!!message && <Text style={styles.bodyText}>{message}</Text>}
      </Card>
      <Title>My Downloaded Courses</Title>
      <View style={styles.grid}>
        {classrooms.length ? classrooms.map(room => (
          <Pressable key={room.id} accessibilityRole="button" focusable tabIndex={0} onKeyDown={event => activateByKeyboard(event, () => onOpen(room))} style={({ hovered, focused }) => [styles.card, styles.clickableCard, (hovered || focused) && styles.clickableCardFocus]} onPress={() => onOpen(room)}>
            <Title>{room.name}</Title>
            <Text style={styles.bodyText}>Open saved resources, quizzes, and grades.</Text>
          </Pressable>
        )) : <Card><Title>No Courses Yet</Title><Text style={styles.bodyText}>Join a teacher group or enter a classroom key to download your first course.</Text></Card>}
      </View>
    </View>
  );
}

function StudentJoinPanel({ user, onConnected }) {
  const [hostUrl, setHostUrl] = useState("");
  const [hostClassroomId, setHostClassroomId] = useState("");
  const [packageText, setPackageText] = useState("");
  const [connectMessage, setConnectMessage] = useState("");
  const [scanning, setScanning] = useState(false);
  const [nearbyPackages, setNearbyPackages] = useState([]);

  function scanForHosts() {
    setScanning(true);
    setConnectMessage("Scanning teacher hotspot groups...");
    setTimeout(() => {
      const hosted = getOfflineStore().hostedPackages || {};
      const packages = Object.values(hosted).filter(item => item?.classroom?.id);
      setNearbyPackages(packages);
      setScanning(false);
      setConnectMessage(packages.length ? "Teacher groups found. Tap Download Resources." : "No local groups found yet. Connect to teacher hotspot, then use URL/Course ID or package import.");
    }, 900);
  }

  async function connectByHost() {
    try {
      setConnectMessage("Connecting and downloading resources...");
      const result = await connectToTeacherHost(hostUrl, hostClassroomId, user);
      setConnectMessage(result.ok ? `Downloaded ${result.classroom.name} for offline use.` : result.message);
      if (result.ok) onConnected(result.classroom);
    } catch (error) {
      setConnectMessage(error.message);
    }
  }

  function importPackageText(text = packageText) {
    try {
      setConnectMessage("Importing classroom package...");
      const result = importClassroomOfflinePackage(JSON.parse(text), user);
      setConnectMessage(result.ok ? `Downloaded ${result.classroom.name} for offline use.` : result.message);
      if (result.ok) onConnected(result.classroom);
    } catch (_error) {
      setConnectMessage("Paste the classroom package JSON from the teacher.");
    }
  }

  return (
    <Card>
      <Title>Join Teacher Group</Title>
      <Text style={styles.bodyText}>Follow these steps to receive lessons from your teacher, even without internet.</Text>
      <View style={styles.stepList}>
        <GuideStep number="1" title="Connect Wi-Fi" text="Connect your phone to the teacher hotspot." />
        <GuideStep number="2" title="Find The Group" text="Scan nearby groups or enter the URL and course ID shown by your teacher." />
        <GuideStep number="3" title="Download Once" text="Resources save on your device and open later without internet." />
      </View>
      <View style={styles.joinStage}>
        <View style={[styles.radar, scanning && styles.radarActive]}>
          <View style={styles.radarRingLarge} />
          <View style={styles.radarRingSmall} />
          <View style={styles.radarDot} />
        </View>
        <View style={styles.joinCopy}>
          <Text style={styles.howTitle}>{scanning ? "Looking For Teacher..." : "Ready To Join"}</Text>
          <Text style={styles.bodyText}>Use scan for preview, or enter the teacher address when you are connected to their hotspot.</Text>
        </View>
      </View>
      <View style={styles.tabs}>
        <Button tone="muted" title="Connect To Wi-Fi" onPress={() => openDeviceSetting("android.settings.WIFI_SETTINGS")} />
      </View>
      <Button title={scanning ? "Scanning..." : "Scan Nearby Teacher Groups"} onPress={scanForHosts} />
      {!!nearbyPackages.length && (
        <View style={styles.grid}>
          {nearbyPackages.map(payload => (
            <Card key={payload.classroom.id} tone="soft">
              <Title>{payload.classroom.name}</Title>
              <Text style={styles.bodyText}>Course ID: {payload.classroom.id}</Text>
              <Button title="Download Course" onPress={() => importPackageText(JSON.stringify(payload))} />
            </Card>
          ))}
        </View>
      )}
      <View style={styles.manualJoin}>
        <Text style={styles.howTitle}>Manual Join</Text>
        <Input value={hostUrl} onChangeText={setHostUrl} placeholder="Teacher address, example http://192.168.43.1:10000" />
        <Input value={hostClassroomId} onChangeText={setHostClassroomId} placeholder="Course ID shown by teacher" onSubmitEditing={connectByHost} />
        <Button title="Join And Download Course" onPress={connectByHost} />
      </View>
      <View style={styles.manualJoin}>
        <Text style={styles.howTitle}>No Hotspot Server?</Text>
        <Text style={styles.bodyText}>Ask the teacher to share the offline package, paste it here, then import.</Text>
        <Input value={packageText} onChangeText={setPackageText} placeholder="Paste teacher offline package" multiline />
        <Button tone="muted" title="Import Package" onPress={() => importPackageText()} />
      </View>
      {!!connectMessage && <Text style={styles.noticeText}>{connectMessage}</Text>}
    </Card>
  );
}

function GuideStep({ number, title, text }) {
  return (
    <View style={styles.guideStep}>
      <Text style={styles.guideNumber}>{number}</Text>
      <View style={styles.guideCopy}>
        <Text style={styles.guideTitle}>{title}</Text>
        <Text style={styles.bodyText}>{text}</Text>
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
          <Pressable key={room.id} accessibilityRole="button" focusable tabIndex={0} onKeyDown={event => activateByKeyboard(event, () => onOpen(room))} style={({ hovered, focused }) => [styles.card, styles.clickableCard, (hovered || focused) && styles.clickableCardFocus]} onPress={() => onOpen(room)}>
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
      <Tabs tab={tab} setTab={setTab} tabs={["group", "resources", "participants", "grades"]} />
      {tab === "group" && <TeacherHostPanel classroom={classroom} onPendingChange={onPendingChange} />}
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
  async function copyPackage() {
    if (!packageText) return;
    try {
      await globalThis.navigator?.clipboard?.writeText(packageText);
      setHostMessage("Offline package copied. Students can import it if hotspot backend is not running.");
    } catch (_error) {
      setHostMessage("Package is ready below. Select and share it with students if needed.");
    }
  }
  async function sync() {
    const result = await syncPendingWrites();
    setHostMessage(result.pending ? `${result.pending} records still waiting for internet.` : "All offline classroom data is synced.");
    onPendingChange?.();
  }
  return (
    <Card>
      <Title>Create Teacher Group</Title>
      <Text style={styles.bodyText}>Share this classroom over hotspot so students can download your lessons and keep them offline.</Text>
      <View style={styles.stepList}>
        <GuideStep number="1" title="Turn On Hotspot" text="Open hotspot settings and let students connect to your Wi-Fi." />
        <GuideStep number="2" title="Start Group" text="Press Host Group to prepare resources for students." />
        <GuideStep number="3" title="Share Details" text="Students use the address and course ID below to join." />
      </View>
      <View style={styles.hostShareBox}>
        <Text style={styles.howTitle}>Student URL</Text>
        <Text style={styles.shareCode}>{defaultHost}</Text>
        <Text style={styles.howTitle}>Course ID</Text>
        <Text style={styles.shareCode}>{classroom.id}</Text>
      </View>
      <Input value={localHostUrl} onChangeText={setLocalHostUrl} placeholder="Local backend URL on teacher device" />
      <View style={styles.tabs}>
        <Button tone="muted" title="Turn On Hotspot" onPress={() => openDeviceSetting("android.settings.TETHER_SETTINGS")} />
        <Button tone="muted" title="Open Wi-Fi Settings" onPress={() => openDeviceSetting("android.settings.WIFI_SETTINGS")} />
        <Button title="Host Group" onPress={hostClassroom} />
        {!!packageText && <Button tone="muted" title="Copy Package" onPress={copyPackage} />}
        <Button tone="muted" title="Sync When Online" onPress={sync} />
      </View>
      {!!packageText && <Input value={packageText} onChangeText={setPackageText} multiline />}
      {!!hostMessage && <Text style={styles.noticeText}>{hostMessage}</Text>}
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
  const [activeSection, setActiveSection] = useState(null);
  const [sectionName, setSectionName] = useState("");
  async function refresh() {
    const nextSections = await listSections(classroom.id);
    setSections(nextSections);
    if (activeSection) {
      const updated = nextSections.find(item => item.id === activeSection.id);
      setActiveSection(updated || null);
    }
  }
  useEffect(() => { refresh(); }, [classroom.id]);
  async function create() {
    if (!sectionName.trim()) return;
    await createSection(classroom.id, sectionName.trim());
    setSectionName("");
    refresh();
  }
  if (activeSection) {
    return (
      <SectionEditor
        classroom={classroom}
        section={activeSection}
        onBack={() => setActiveSection(null)}
        onDeleted={() => {
          setActiveSection(null);
          refresh();
        }}
      />
    );
  }
  return (
    <View>
      <Card>
        <Title>Create Section</Title>
        <Text style={styles.bodyText}>Sections keep resources and quizzes organized by topic or lesson.</Text>
        <Input value={sectionName} onChangeText={setSectionName} placeholder="Section Name" onSubmitEditing={create} />
        <Button title="Create Section" onPress={create} />
      </Card>
      <Title>Sections</Title>
      <View style={styles.grid}>
        {sections.length ? sections.map(section => (
          <Pressable key={section.id} accessibilityRole="button" focusable tabIndex={0} onKeyDown={event => activateByKeyboard(event, () => setActiveSection(section))} style={({ hovered, focused }) => [styles.card, styles.clickableCard, (hovered || focused) && styles.clickableCardFocus]} onPress={() => setActiveSection(section)}>
            <Title>{section.name}</Title>
            <Text style={styles.bodyText}>Open section to upload resources, create quizzes, and manage content.</Text>
          </Pressable>
        )) : <Card><Title>No Sections Yet</Title><Text style={styles.bodyText}>Create a section first, then open it to add resources and quizzes.</Text></Card>}
      </View>
    </View>
  );
}

function SectionEditor({ classroom, section, onBack, onDeleted }) {
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
  async function removeSection() {
    const ok = typeof window === "undefined" ? true : window.confirm(`Delete section "${section.name}" and its resources/quizzes?`);
    if (!ok) return;
    await deleteSection(classroom.id, section.id);
    onDeleted?.();
  }
  async function removeResource(resource) {
    const ok = typeof window === "undefined" ? true : window.confirm(`Delete resource "${resource.title}"?`);
    if (!ok) return;
    await deleteResource(classroom.id, section.id, resource.id);
    refresh();
  }
  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.manageText}>
          <Title>{section.name}</Title>
          <Text style={styles.bodyText}>Manage resources and quizzes inside this section.</Text>
        </View>
        <View style={styles.tableActions}>
          <Button tone="muted" title="Back To Sections" onPress={onBack} />
          <Button tone="danger" title="Delete Section" onPress={removeSection} />
        </View>
      </View>
      <View style={styles.sectionPanel}>
        <Title>Resources</Title>
        <Text style={styles.bodyText}>Upload files students will download when they join the teacher group.</Text>
        <View style={styles.sectionTools}>
          <Input value={resourceTitle} onChangeText={setResourceTitle} placeholder="Resource Title" />
          <Button title="Upload Resource" onPress={pickFile} />
        </View>
        {resources.length ? resources.map(item => (
          <View key={item.id} style={styles.manageRow}>
            <View style={styles.manageText}>
              <Text style={styles.heading}>{item.title}</Text>
              <Text style={styles.bodyText}>{item.fileName} | {formatFileSize(item.fileSize || 0)}</Text>
            </View>
            <Button tone="danger" title="Delete" onPress={() => removeResource(item)} />
          </View>
        )) : <Text style={styles.bodyText}>No resources in this section yet.</Text>}
      </View>
      <View style={styles.sectionPanel}>
        <Title>Quizzes</Title>
        <Text style={styles.bodyText}>Create quizzes inside this section for students to complete offline.</Text>
        <View style={styles.sectionTools}>
          <Input value={quizTitle} onChangeText={setQuizTitle} placeholder="Quiz Title" />
          <Input value={timer} onChangeText={setTimer} placeholder="Timer Minutes" keyboardType="numeric" onSubmitEditing={makeQuiz} />
          <Button title="Create Quiz" onPress={makeQuiz} />
        </View>
        {quizzes.length ? quizzes.map(quiz => <QuizEditor key={quiz.id} classroom={classroom} section={section} quiz={quiz} refresh={refresh} />) : <Text style={styles.bodyText}>No quizzes in this section yet.</Text>}
      </View>
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
  async function removeQuiz() {
    const ok = typeof window === "undefined" ? true : window.confirm(`Delete quiz "${quiz.title}"?`);
    if (!ok) return;
    await deleteQuiz(classroom.id, section.id, quiz.id);
    refresh();
  }
  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.heading}>{quiz.title} - {quiz.published ? "Published" : "Draft"}</Text>
        <Button tone="danger" title="Delete Quiz" onPress={removeQuiz} />
      </View>
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
  useEffect(() => {
    if (!BackHandler?.addEventListener) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (activeQuiz) {
        setActiveQuiz(null);
        return true;
      }
      if (activeResource) {
        setActiveResource(null);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [activeQuiz, activeResource]);
  if (activeQuiz) return <TakeQuiz classroom={classroom} quiz={activeQuiz} user={user} onDone={() => setActiveQuiz(null)} />;
  if (activeResource) return <ResourceViewer resource={activeResource} onBack={() => setActiveResource(null)} />;
  return (
    <View>
      {sections.map(section => (
        <Card key={section.id}>
          <Title>{section.name}</Title>
          {section.resources.length ? section.resources.map(item => (
            <Pressable key={item.id} accessibilityRole="button" focusable tabIndex={0} onKeyDown={event => activateByKeyboard(event, () => setActiveResource(item))} style={({ hovered, focused }) => [styles.progressCard, styles.clickableCard, (hovered || focused) && styles.clickableCardFocus]} onPress={() => setActiveResource(item)}>
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
  const { height } = useWindowDimensions();
  const viewerHeight = Math.max(460, height - 190);
  return (
    <View style={styles.fullScreenViewer}>
      <View style={styles.viewerTopBar}>
        <View style={styles.manageText}>
          <Title>{resource.title}</Title>
          <Text style={styles.bodyText}>{resource.fileName}</Text>
        </View>
        <Button tone="muted" title="Back To Classroom" onPress={onBack} />
      </View>
      <View style={[styles.viewerCanvas, { minHeight: viewerHeight }]}>
        {resource.fileDataUrl ? (
          resource.fileType?.startsWith("image/") ? (
            <Image source={{ uri: resource.fileDataUrl }} style={[styles.resourceImageFull, { height: viewerHeight - 40 }]} resizeMode="contain" />
          ) : (
            <View style={styles.filePreviewMessage}>
              <Title>{resource.fileName}</Title>
              <Text style={styles.bodyText}>This file is saved offline on this device. Full-screen preview for video, audio, PDF, and documents can be connected later.</Text>
            </View>
          )
        ) : (
          <View style={styles.filePreviewMessage}>
            <Title>Preview Not Downloaded Yet</Title>
            <Text style={styles.bodyText}>This file is listed offline, but preview data is not stored on this device yet. Ask the teacher to host or re-upload it while students are connected.</Text>
          </View>
        )}
      </View>
    </View>
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
        <Pressable key={answerIndex} accessibilityRole="button" focusable tabIndex={0} onKeyDown={event => activateByKeyboard(event, () => setAnswers({ ...answers, [index]: answerIndex }))} style={({ hovered, focused }) => [styles.choice, answers[index] === answerIndex && styles.choiceSelected, (hovered || focused) && styles.choiceFocus]} onPress={() => setAnswers({ ...answers, [index]: answerIndex })}>
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
  async function removeStudent(item) {
    const ok = typeof window === "undefined" ? true : window.confirm(`Remove ${item.name} from this class?`);
    if (!ok) return;
    await removeParticipant(classroom.id, item.studentId || item.id);
    refresh();
  }
  return (
    <Card>
      <Title>Participants</Title>
      {participants.length ? participants.map(item => (
        <View key={item.id} style={styles.manageRow}>
          <View style={styles.manageText}>
            <Text style={styles.heading}>{item.name}</Text>
            <Text style={styles.bodyText}>{item.email}</Text>
          </View>
          <Button tone="danger" title="Remove" onPress={() => removeStudent(item)} />
        </View>
      )) : <Text style={styles.bodyText}>No students have joined yet.</Text>}
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
  async function removeGradeCell(grade) {
    if (!grade?.id) return;
    await deleteGrade(classroom.id, grade.id);
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
                        <View style={styles.gradeCellEditor}>
                          <Input value={grade?.value || ""} onChangeText={value => updateCell(participant, column, value)} />
                          {!!grade?.id && <Button tone="danger" title="Clear" onPress={() => removeGradeCell(grade)} />}
                        </View>
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
  return <View style={[styles.card, tone === "glass" && styles.glassCard, tone === "soft" && styles.softCard]}>{children}</View>;
}

function Title({ children, light }) {
  return <Text style={[styles.title, light && styles.lightTitle]}>{children}</Text>;
}

function Input(props) {
  return <TextInput {...props} style={[styles.input, props.multiline && styles.inputMultiline]} placeholderTextColor="#64748b" returnKeyType={props.multiline ? "default" : "done"} />;
}

function Button({ title, onPress, tone = "primary" }) {
  function handleKey(event) {
    const key = event?.nativeEvent?.key || event?.key;
    if ((key === "Enter" || key === " ") && onPress) {
      event.preventDefault?.();
      onPress(event);
    }
  }
  return <Pressable accessibilityRole="button" focusable tabIndex={0} onKeyDown={handleKey} style={({ hovered, focused, pressed }) => [styles.button, tone === "muted" && styles.buttonMuted, tone === "danger" && styles.buttonDanger, tone === "light" && styles.buttonLight, tone === "outline" && styles.buttonOutline, tone === "start" && styles.buttonStart, tone === "heroOutline" && styles.buttonHeroOutline, (hovered || focused) && styles.buttonFocus, pressed && styles.buttonPressed]} onPress={onPress}>
    <Text style={[styles.buttonText, tone === "light" && styles.buttonLightText, tone === "start" && styles.buttonStartText, tone === "heroOutline" && styles.buttonHeroOutlineText]}>{title}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  page: { backgroundColor: "#f5f8fc" },
  content: { padding: 20, gap: 22, width: "100%", maxWidth: 1180, alignSelf: "center" },
  contentCompact: { padding: 14, gap: 16 },
  nav: { backgroundColor: "rgba(255,255,255,0.92)", borderColor: "#dce6f2", borderWidth: 1, borderRadius: 10, padding: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, boxShadow: "0 10px 28px rgba(15,23,42,0.10)" },
  navCompact: { alignItems: "flex-start" },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandLogoImage: { width: 42, height: 42, borderRadius: 8, backgroundColor: "white", borderColor: "#d8e0ea", borderWidth: 1 },
  logo: { color: "#111827", fontSize: 26, fontWeight: "900" },
  navLinks: { flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap" },
  navLinksCompact: { width: "100%", gap: 10 },
  navButton: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 },
  navButtonFocus: { backgroundColor: "#eef5ff" },
  navLink: { color: "#1f2a44", fontWeight: "800" },
  brandLockupFocus: { opacity: 0.82 },
  statusPill: { color: "#155e75", backgroundColor: "#e0f7fa", borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10, fontWeight: "900", overflow: "hidden" },
  statusPillOffline: { color: "#9a3412", backgroundColor: "#ffedd5" },
  hero: { minHeight: 590, backgroundImage: "linear-gradient(135deg, #ffffff 0%, #eef5ff 42%, #4b5cff 100%)", borderRadius: 10, padding: 36, justifyContent: "center", alignItems: "center", overflow: "hidden", position: "relative", boxShadow: "0 24px 60px rgba(75,92,255,0.18)" },
  heroCompact: { minHeight: 520, padding: 24 },
  heroShapes: { position: "absolute", inset: 0 },
  shape: { position: "absolute", width: 160, height: 160, borderRadius: 80, opacity: 0.32 },
  shapeBlue: { backgroundColor: "#4b5cff", top: 74, left: 94 },
  shapeGreen: { backgroundColor: "#2ecc71", right: 110, bottom: 84 },
  shapeMint: { backgroundColor: "#78f0d0", width: 92, height: 92, borderRadius: 46, left: "18%", bottom: 112 },
  shapeSoft: { backgroundColor: "#ffffff", width: 120, height: 120, borderRadius: 60, right: "18%", top: 118 },
  heroCenter: { alignItems: "center", justifyContent: "center", gap: 18, width: "100%", zIndex: 1 },
  heroLogoImage: { width: 170, height: 120, borderRadius: 8, backgroundColor: "white", borderColor: "rgba(255,255,255,0.75)", borderWidth: 1 },
  heroLogoImageCompact: { width: 132, height: 92 },
  heroTitle: { color: "#111827", fontSize: 68, fontWeight: "900", textAlign: "center", textShadowColor: "rgba(255,255,255,0.7)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 12 },
  heroTitleCompact: { fontSize: 44 },
  heroSubtitle: { color: "#2b3340", fontSize: 21, lineHeight: 30, fontWeight: "700", textAlign: "center", maxWidth: 720 },
  heroText: { color: "#333333", fontSize: 18, lineHeight: 28, textAlign: "center", maxWidth: 680, alignSelf: "center", marginBottom: 4 },
  heroActions: { flexDirection: "row", gap: 14, flexWrap: "wrap", justifyContent: "center", marginTop: 8 },
  loginSelection: { flexDirection: "row", flexWrap: "wrap", gap: 18, marginTop: 22 },
  glassCard: { backgroundColor: "rgba(255,255,255,0.88)", borderColor: "#dce6f2" },
  softCard: { backgroundColor: "#f8fbff" },
  lightText: { color: "#e2e8f0", lineHeight: 24 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 18 },
  grid4: { flexDirection: "row", flexWrap: "wrap", gap: 18 },
  card: { backgroundColor: "white", borderColor: "#d8e0ea", borderWidth: 1, borderRadius: 8, padding: 22, gap: 12, flexGrow: 1, flexBasis: 260, boxShadow: "0 8px 22px rgba(15,23,42,0.07)" },
  clickableCard: { cursor: "pointer" },
  clickableCardFocus: { borderColor: "#4b5cff", transform: [{ translateY: -2 }], boxShadow: "0 14px 30px rgba(75,92,255,0.16)" },
  title: { color: "#123a5f", fontSize: 24, fontWeight: "900", flexShrink: 1 },
  lightTitle: { color: "white" },
  heading: { color: "#0f172a", fontSize: 18, fontWeight: "800", marginTop: 10 },
  bodyText: { color: "#46556d", lineHeight: 24 },
  input: { borderColor: "#cbd5e1", borderWidth: 1, borderRadius: 8, padding: 14, fontSize: 16, backgroundColor: "white", color: "#111827", outlineStyle: "none" },
  inputMultiline: { minHeight: 110, textAlignVertical: "top" },
  button: { backgroundColor: "#155e75", borderRadius: 8, padding: 14, alignItems: "center", marginTop: 4, boxShadow: "0 8px 18px rgba(21,94,117,0.15)" },
  buttonMuted: { backgroundColor: "#475569" },
  buttonDanger: { backgroundColor: "#dc2626" },
  buttonLight: { backgroundColor: "white" },
  buttonOutline: { backgroundColor: "transparent", borderColor: "white", borderWidth: 2 },
  buttonStart: { backgroundColor: "#2ecc71", paddingHorizontal: 28, boxShadow: "0 12px 26px rgba(46,204,113,0.28)" },
  buttonHeroOutline: { backgroundColor: "rgba(255,255,255,0.34)", borderColor: "rgba(17,24,39,0.22)", borderWidth: 1, paddingHorizontal: 28 },
  buttonFocus: { transform: [{ translateY: -1 }], boxShadow: "0 12px 26px rgba(75,92,255,0.22)" },
  buttonPressed: { transform: [{ translateY: 0 }], opacity: 0.88 },
  buttonText: { color: "white", fontWeight: "800" },
  buttonLightText: { color: "#2563eb" },
  buttonStartText: { color: "white" },
  buttonHeroOutlineText: { color: "#111827" },
  error: { color: "#ef4444", fontWeight: "700" },
  authShell: { minHeight: 520, backgroundImage: "linear-gradient(135deg, #ffffff 0%, #eef5ff 45%, #4b5cff 100%)", borderRadius: 10, padding: 28, alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative", boxShadow: "0 18px 46px rgba(75,92,255,0.16)" },
  authShapes: { position: "absolute", inset: 0 },
  authShapeBlue: { backgroundColor: "#4b5cff", left: 70, top: 64 },
  authShapeGreen: { backgroundColor: "#2ecc71", right: 80, bottom: 64 },
  authPanel: { width: "100%", maxWidth: 470, backgroundColor: "rgba(255,255,255,0.88)", borderColor: "rgba(255,255,255,0.75)", borderWidth: 1, borderRadius: 8, padding: 26, gap: 13, zIndex: 1, boxShadow: "0 18px 40px rgba(15,23,42,0.14)" },
  authBrand: { color: "#4b5cff", fontSize: 18, fontWeight: "900", textTransform: "uppercase" },
  summaryBand: { backgroundColor: "#123a5f", borderRadius: 8, padding: 18, flexDirection: "row", gap: 14, flexWrap: "wrap", boxShadow: "0 14px 34px rgba(18,58,95,0.20)" },
  summaryItem: { backgroundColor: "rgba(255,255,255,0.10)", borderColor: "rgba(255,255,255,0.18)", borderWidth: 1, borderRadius: 8, padding: 16, flexGrow: 1, flexBasis: 240, gap: 4 },
  summaryLabel: { color: "#bae6fd", fontWeight: "900" },
  summaryValue: { color: "white", fontSize: 24, fontWeight: "900" },
  summaryMeta: { color: "#dbeafe", fontWeight: "700" },
  statsBand: { backgroundColor: "#123a5f", borderRadius: 8, padding: 22, flexDirection: "row", justifyContent: "space-around", gap: 14, flexWrap: "wrap", boxShadow: "0 14px 34px rgba(18,58,95,0.20)" },
  statCounter: { alignItems: "center", minWidth: 150, padding: 8 },
  statValue: { color: "white", fontSize: 32, fontWeight: "900" },
  statLabel: { color: "#dbeafe", fontWeight: "800" },
  howGrid: { flexDirection: "row", flexWrap: "wrap", gap: 18 },
  howStep: { backgroundColor: "white", borderColor: "#d8e0ea", borderWidth: 1, borderRadius: 8, padding: 22, gap: 10, flexGrow: 1, flexBasis: 300, boxShadow: "0 8px 22px rgba(15,23,42,0.07)" },
  howNumber: { color: "#2ecc71", fontSize: 14, fontWeight: "900" },
  howTitle: { color: "#123a5f", fontSize: 20, fontWeight: "900" },
  stepList: { gap: 10 },
  guideStep: { backgroundColor: "#f8fbff", borderColor: "#d8e0ea", borderWidth: 1, borderRadius: 8, padding: 14, flexDirection: "row", gap: 12, alignItems: "flex-start" },
  guideNumber: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#2ecc71", color: "white", textAlign: "center", lineHeight: 30, fontWeight: "900", overflow: "hidden" },
  guideCopy: { flex: 1, minWidth: 0 },
  guideTitle: { color: "#123a5f", fontSize: 16, fontWeight: "900" },
  joinStage: { backgroundColor: "#f8fbff", borderColor: "#d8e0ea", borderWidth: 1, borderRadius: 8, padding: 18, flexDirection: "row", alignItems: "center", gap: 18, flexWrap: "wrap" },
  joinCopy: { flex: 1, minWidth: 220 },
  radar: { width: 132, height: 132, borderRadius: 66, backgroundColor: "#eef5ff", alignItems: "center", justifyContent: "center", position: "relative", borderColor: "#c7d2fe", borderWidth: 1 },
  radarActive: { backgroundColor: "#ecfdf5", borderColor: "#2ecc71" },
  radarRingLarge: { position: "absolute", width: 104, height: 104, borderRadius: 52, borderColor: "#4b5cff", borderWidth: 2, opacity: 0.32 },
  radarRingSmall: { position: "absolute", width: 62, height: 62, borderRadius: 31, borderColor: "#2ecc71", borderWidth: 2, opacity: 0.45 },
  radarDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#4b5cff" },
  hostShareBox: { backgroundColor: "#f8fbff", borderColor: "#d8e0ea", borderWidth: 1, borderRadius: 8, padding: 18, gap: 8 },
  shareCode: { color: "#111827", backgroundColor: "white", borderColor: "#d8e0ea", borderWidth: 1, borderRadius: 8, padding: 12, fontWeight: "900", overflow: "hidden" },
  manualJoin: { backgroundColor: "#f8fbff", borderColor: "#d8e0ea", borderWidth: 1, borderRadius: 8, padding: 16, gap: 10 },
  noticeText: { color: "#155e75", backgroundColor: "#e0f7fa", borderRadius: 8, padding: 12, fontWeight: "800", overflow: "hidden" },
  tabs: { flexDirection: "row", gap: 10, flexWrap: "wrap", marginVertical: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  progressCard: { backgroundColor: "#f8fafc", borderColor: "#d8e0ea", borderWidth: 1, borderRadius: 8, padding: 18, gap: 8 },
  sectionPanel: { backgroundColor: "#f8fbff", borderColor: "#d8e0ea", borderWidth: 1, borderRadius: 8, padding: 16, gap: 12 },
  sectionTools: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  manageRow: { backgroundColor: "white", borderColor: "#d8e0ea", borderWidth: 1, borderRadius: 8, padding: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  manageText: { flex: 1, minWidth: 220, gap: 4 },
  tableWrap: { backgroundColor: "white", borderRadius: 8, borderColor: "#d8e0ea", borderWidth: 1 },
  tableRow: { flexDirection: "row", alignItems: "stretch" },
  tableCell: { width: 190, minHeight: 58, padding: 12, borderBottomColor: "#e2e8f0", borderBottomWidth: 1, borderRightColor: "#e2e8f0", borderRightWidth: 1, justifyContent: "center" },
  tableHeader: { backgroundColor: "#f8fafc" },
  tableHeaderText: { color: "#2563eb", fontWeight: "800" },
  gradeColumnHeader: { gap: 8 },
  gradeCellEditor: { gap: 8 },
  tableActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  resourceImage: { width: "100%", height: 420, backgroundColor: "#f8fafc", borderRadius: 14 },
  fullScreenViewer: { backgroundColor: "#0f172a", borderRadius: 8, overflow: "hidden", minHeight: 620, boxShadow: "0 18px 42px rgba(15,23,42,0.22)" },
  viewerTopBar: { backgroundColor: "white", borderBottomColor: "#d8e0ea", borderBottomWidth: 1, padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  viewerCanvas: { padding: 20, alignItems: "center", justifyContent: "center" },
  resourceImageFull: { width: "100%", backgroundColor: "#020617", borderRadius: 8 },
  filePreviewMessage: { width: "100%", maxWidth: 640, backgroundColor: "white", borderRadius: 8, padding: 22, gap: 12 },
  question: { fontSize: 22, fontWeight: "900", color: "#0f172a", lineHeight: 32 },
  choice: { borderColor: "#e2e8f0", borderWidth: 1, borderRadius: 12, padding: 14, backgroundColor: "#f8fafc" },
  choiceFocus: { borderColor: "#4b5cff" },
  choiceSelected: { borderColor: "#2563eb", backgroundColor: "#eff6ff" }
});
