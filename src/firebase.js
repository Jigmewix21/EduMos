import { initializeApp } from "firebase/app";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  enableIndexedDbPersistence,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  setDoc,
  updateDoc,
  where
} from "firebase/firestore";
import {
  deleteCollectionItem,
  getCollection,
  getOfflineStore,
  isOnline,
  queueWrite,
  replacePendingWrites,
  setCollectionItem,
  setOfflineStore
} from "./offlineStore";
import { apiBaseUrl, firebaseConfig } from "./config";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

if (typeof globalThis !== "undefined" && typeof window !== "undefined" && typeof document !== "undefined") {
  enableIndexedDbPersistence(db).catch(() => {});
}

const keyOf = (...parts) => parts.join("__");
const localId = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const FIREBASE_TIMEOUT_MS = 10000;
const LOCAL_HOST_TIMEOUT_MS = 18000;
const COMMON_TEACHER_HOSTS = [
  apiBaseUrl,
  "http://192.168.43.1:10000",
  "http://192.168.49.1:10000",
  "http://192.168.4.1:10000",
  "http://172.20.10.1:10000",
  "http://10.0.0.1:10000"
];

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ]);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryLocalRequest(operation, attempts = 4, delayMs = 1800) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(delayMs * attempt);
    }
  }
  throw lastError;
}

function cacheUser(role, user) {
  if (user?.email) setCollectionItem("users", keyOf(role, user.email.trim().toLowerCase()), user);
}

function cacheClassroom(classroom) {
  setCollectionItem("classrooms", classroom.id, classroom);
}

function cacheParticipant(classroomId, participant) {
  setCollectionItem("participants", keyOf(classroomId, participant.studentId || participant.id), participant);
}

function cacheSection(classroomId, section) {
  setCollectionItem("sections", keyOf(classroomId, section.id), { ...section, classroomId });
}

function cacheResource(classroomId, sectionId, resource) {
  setCollectionItem("resources", keyOf(classroomId, sectionId, resource.id), { ...resource, classroomId, sectionId });
}

function cacheQuiz(classroomId, sectionId, quiz) {
  setCollectionItem("quizzes", keyOf(classroomId, sectionId, quiz.id), { ...quiz, classroomId, sectionId });
}

function cacheGrade(classroomId, grade) {
  setCollectionItem("grades", keyOf(classroomId, grade.id), { ...grade, classroomId });
}

function cacheGradeColumn(classroomId, column) {
  setCollectionItem("gradeColumns", keyOf(classroomId, column.id), { ...column, classroomId });
}

function mergeById(remoteItems, localItems) {
  const merged = new Map();
  (remoteItems || []).forEach(item => merged.set(item.id, item));
  (localItems || []).forEach(item => merged.set(item.id, item));
  return Array.from(merged.values());
}

function normalizeIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveStudentForGrade(grade, participants) {
  const byEmail = normalizeIdentity(grade.studentEmail || grade.email);
  if (byEmail) {
    const match = participants.find(item => normalizeIdentity(item.email) === byEmail);
    if (match) return match.studentId || match.id;
  }
  const byName = normalizeIdentity(grade.studentName || grade.name);
  if (byName) {
    const match = participants.find(item => normalizeIdentity(item.name) === byName);
    if (match) return match.studentId || match.id;
  }
  return grade.studentId;
}

async function tryFirestore(operation, fallback) {
  if (!isOnline()) return fallback();
  try {
    return await withTimeout(operation(), FIREBASE_TIMEOUT_MS, "Firebase request timed out");
  } catch (_error) {
    return fallback();
  }
}

export async function findUser(role, email, password) {
  const cleanEmail = email.trim().toLowerCase();
  return tryFirestore(async () => {
    const snap = await getDocs(
      query(
        collection(db, role === "teacher" ? "teachers" : "students"),
        where("email", "==", cleanEmail),
        where("password", "==", password),
        limit(1)
      )
    );
    if (snap.empty) return null;
    const user = { id: snap.docs[0].id, ...snap.docs[0].data() };
    cacheUser(role, user);
    return user;
  }, () => {
    const cached = getCollection("users")[keyOf(role, cleanEmail)];
    return cached?.password === password ? cached : null;
  });
}

export async function createTeacher(name, email, password) {
  if (!isOnline()) return { ok: false, message: "Teacher account creation needs internet once. Existing cached accounts can login offline." };
  const cleanEmail = email.trim().toLowerCase();
  try {
    const existing = await withTimeout(
      getDocs(query(collection(db, "teachers"), where("email", "==", cleanEmail), limit(1))),
      FIREBASE_TIMEOUT_MS,
      "Firebase request timed out"
    );
    if (!existing.empty) return { ok: false, message: "Teacher already exists" };
    const data = { name, email: cleanEmail, password, createdAt: Date.now() };
    const ref = await withTimeout(addDoc(collection(db, "teachers"), data), FIREBASE_TIMEOUT_MS, "Firebase request timed out");
    const teacher = { id: ref.id, ...data };
    cacheUser("teacher", teacher);
    return { ok: true, teacher };
  } catch (_error) {
    return { ok: false, message: "Could not create account. Check internet and try again." };
  }
}

export async function createClassroom(teacherId, name, key) {
  const cleanKey = key.trim().toUpperCase();
  const cachedMatch = Object.values(getCollection("classrooms")).find(item => item.enrollmentKey === cleanKey);
  if (cachedMatch) return { ok: false, message: "Classroom key already exists" };
  const classroom = {
    id: localId("classroom"),
    teacherId,
    name,
    enrollmentKey: cleanKey,
    createdAt: Date.now()
  };
  cacheClassroom(classroom);
  return tryFirestore(async () => {
    const existing = await getDocs(
      query(collection(db, "classrooms"), where("enrollmentKey", "==", cleanKey), limit(1))
    );
    if (!existing.empty) return { ok: false, message: "Classroom key already exists" };
    await setDoc(doc(db, "classrooms", classroom.id), classroom);
    return { ok: true, classroom };
  }, () => {
    queueWrite({ action: "setClassroom", classroom });
    return { ok: true, classroom, offline: true };
  });
}

export async function listTeacherClassrooms(teacherId) {
  return tryFirestore(async () => {
    const snap = await getDocs(query(collection(db, "classrooms"), where("teacherId", "==", teacherId)));
    const classrooms = snap.docs.map(item => ({ id: item.id, ...item.data() }));
    classrooms.forEach(cacheClassroom);
    const localClassrooms = Object.values(getCollection("classrooms")).filter(item => item.teacherId === teacherId);
    return mergeById(classrooms, localClassrooms);
  }, () => Object.values(getCollection("classrooms")).filter(item => item.teacherId === teacherId));
}

export async function deleteClassroom(classroomId) {
  deleteCollectionItem("classrooms", classroomId);
  Object.values(getCollection("participants"))
    .filter(item => item.classroomId === classroomId)
    .forEach(item => deleteCollectionItem("participants", keyOf(classroomId, item.studentId || item.id)));
  Object.values(getCollection("sections"))
    .filter(item => item.classroomId === classroomId)
    .forEach(item => deleteCollectionItem("sections", keyOf(classroomId, item.id)));
  Object.values(getCollection("resources"))
    .filter(item => item.classroomId === classroomId)
    .forEach(item => deleteCollectionItem("resources", keyOf(classroomId, item.sectionId, item.id)));
  Object.values(getCollection("quizzes"))
    .filter(item => item.classroomId === classroomId)
    .forEach(item => deleteCollectionItem("quizzes", keyOf(classroomId, item.sectionId, item.id)));
  Object.values(getCollection("grades"))
    .filter(item => item.classroomId === classroomId)
    .forEach(item => deleteCollectionItem("grades", keyOf(classroomId, item.id)));
  Object.values(getCollection("gradeColumns"))
    .filter(item => item.classroomId === classroomId)
    .forEach(item => deleteCollectionItem("gradeColumns", keyOf(classroomId, item.id)));
  return tryFirestore(
    () => deleteDoc(doc(db, "classrooms", classroomId)),
    () => queueWrite({ action: "deleteClassroom", classroomId })
  );
}

export async function enrollStudent(student, key) {
  const cleanKey = key.trim().toUpperCase();
  const saveParticipant = async classroom => {
    const participant = {
      id: student.id,
      classroomId: classroom.id,
      studentId: student.id,
      name: student.name,
      email: student.email,
      joinedAt: Date.now()
    };
    cacheClassroom(classroom);
    cacheParticipant(classroom.id, participant);
    await setDoc(doc(db, "classrooms", classroom.id, "participants", student.id), {
      studentId: student.id,
      name: student.name,
      email: student.email,
      joinedAt: participant.joinedAt
    });
    return { ok: true, classroom };
  };
  return tryFirestore(async () => {
    const snap = await getDocs(
      query(collection(db, "classrooms"), where("enrollmentKey", "==", cleanKey), limit(1))
    );
    if (snap.empty) return { ok: false, message: "Invalid classroom key" };
    return saveParticipant({ id: snap.docs[0].id, ...snap.docs[0].data() });
  }, () => {
    const classroom = Object.values(getCollection("classrooms")).find(item => item.enrollmentKey === cleanKey);
    if (!classroom) return { ok: false, message: "Invalid classroom key. Connect to teacher host or sync this course first." };
    const participant = {
      id: student.id,
      classroomId: classroom.id,
      studentId: student.id,
      name: student.name,
      email: student.email,
      joinedAt: Date.now()
    };
    cacheParticipant(classroom.id, participant);
    queueWrite({ action: "setParticipant", classroomId: classroom.id, participant });
    return { ok: true, classroom, offline: true };
  });
}

export async function listStudentClassrooms(studentId) {
  return tryFirestore(async () => {
    const all = await getDocs(collection(db, "classrooms"));
    const results = [];
    const localParticipantRooms = Object.values(getCollection("participants"))
      .filter(item => item.studentId === studentId)
      .map(item => item.classroomId);
    for (const item of all.docs) {
      const classroom = { id: item.id, ...item.data() };
      cacheClassroom(classroom);
      const participant = await getDoc(doc(db, "classrooms", item.id, "participants", studentId));
      if (participant.exists()) {
        cacheParticipant(item.id, { id: studentId, classroomId: item.id, ...participant.data() });
        results.push(classroom);
      }
    }
    const localClassrooms = Object.values(getCollection("classrooms")).filter(item => localParticipantRooms.includes(item.id));
    return mergeById(results, localClassrooms);
  }, () => {
    const participantRooms = Object.values(getCollection("participants"))
      .filter(item => item.studentId === studentId)
      .map(item => item.classroomId);
    return Object.values(getCollection("classrooms")).filter(item => participantRooms.includes(item.id));
  });
}

export async function listParticipants(classroomId) {
  return tryFirestore(async () => {
    const snap = await getDocs(collection(db, "classrooms", classroomId, "participants"));
    const participants = snap.docs.map(item => ({ id: item.id, classroomId, ...item.data() }));
    participants.forEach(item => cacheParticipant(classroomId, item));
    const localParticipants = Object.values(getCollection("participants")).filter(item => item.classroomId === classroomId);
    return mergeById(participants, localParticipants);
  }, () => Object.values(getCollection("participants")).filter(item => item.classroomId === classroomId));
}

export async function removeParticipant(classroomId, studentId) {
  deleteCollectionItem("participants", keyOf(classroomId, studentId));
  return tryFirestore(
    () => deleteDoc(doc(db, "classrooms", classroomId, "participants", studentId)),
    () => queueWrite({ action: "deleteParticipant", classroomId, studentId })
  );
}

export async function createSection(classroomId, name) {
  const section = {
    id: localId("section"),
    classroomId,
    name,
    createdAt: Date.now()
  };
  cacheSection(classroomId, section);
  return tryFirestore(async () => {
    await setDoc(doc(db, "classrooms", classroomId, "sections", section.id), section);
    return section;
  }, () => {
    queueWrite({ action: "setSection", classroomId, section });
    return section;
  });
}

export async function listSections(classroomId) {
  return tryFirestore(async () => {
    const snap = await getDocs(collection(db, "classrooms", classroomId, "sections"));
    const sections = snap.docs.map(item => ({ id: item.id, classroomId, ...item.data() }));
    sections.forEach(item => cacheSection(classroomId, item));
    const localSections = Object.values(getCollection("sections")).filter(item => item.classroomId === classroomId);
    return mergeById(sections, localSections);
  }, () => Object.values(getCollection("sections")).filter(item => item.classroomId === classroomId));
}

export async function deleteSection(classroomId, sectionId) {
  deleteCollectionItem("sections", keyOf(classroomId, sectionId));
  Object.values(getCollection("resources"))
    .filter(item => item.classroomId === classroomId && item.sectionId === sectionId)
    .forEach(item => deleteCollectionItem("resources", keyOf(classroomId, sectionId, item.id)));
  Object.values(getCollection("quizzes"))
    .filter(item => item.classroomId === classroomId && item.sectionId === sectionId)
    .forEach(item => deleteCollectionItem("quizzes", keyOf(classroomId, sectionId, item.id)));
  return tryFirestore(
    () => deleteDoc(doc(db, "classrooms", classroomId, "sections", sectionId)),
    () => queueWrite({ action: "deleteSection", classroomId, sectionId })
  );
}

export async function saveResource(classroomId, sectionId, resource) {
  const saved = {
    id: localId("resource"),
    classroomId,
    sectionId,
    ...resource,
    createdAt: Date.now()
  };
  cacheResource(classroomId, sectionId, saved);
  return tryFirestore(async () => {
    await setDoc(doc(db, "classrooms", classroomId, "sections", sectionId, "resources", saved.id), saved);
    return saved;
  }, () => {
    queueWrite({ action: "setResource", classroomId, sectionId, resource: saved });
    return saved;
  });
}

export async function listResources(classroomId, sectionId) {
  return tryFirestore(async () => {
    const snap = await getDocs(collection(db, "classrooms", classroomId, "sections", sectionId, "resources"));
    const resources = snap.docs.map(item => ({ id: item.id, classroomId, sectionId, ...item.data() }));
    resources.forEach(item => cacheResource(classroomId, sectionId, item));
    const localResources = Object.values(getCollection("resources")).filter(item => item.classroomId === classroomId && item.sectionId === sectionId);
    return mergeById(resources, localResources);
  }, () => Object.values(getCollection("resources")).filter(item => item.classroomId === classroomId && item.sectionId === sectionId));
}

export async function deleteResource(classroomId, sectionId, resourceId) {
  deleteCollectionItem("resources", keyOf(classroomId, sectionId, resourceId));
  return tryFirestore(
    () => deleteDoc(doc(db, "classrooms", classroomId, "sections", sectionId, "resources", resourceId)),
    () => queueWrite({ action: "deleteResource", classroomId, sectionId, resourceId })
  );
}

export async function createQuiz(classroomId, sectionId, quiz) {
  const saved = {
    id: localId("quiz"),
    classroomId,
    sectionId,
    ...quiz,
    published: false,
    questions: [],
    createdAt: Date.now()
  };
  cacheQuiz(classroomId, sectionId, saved);
  return tryFirestore(async () => {
    await setDoc(doc(db, "classrooms", classroomId, "sections", sectionId, "quizzes", saved.id), saved);
    return saved;
  }, () => {
    queueWrite({ action: "setQuiz", classroomId, sectionId, quiz: saved });
    return saved;
  });
}

export async function updateQuiz(classroomId, sectionId, quizId, patch) {
  const existing = getCollection("quizzes")[keyOf(classroomId, sectionId, quizId)] || { id: quizId, classroomId, sectionId };
  cacheQuiz(classroomId, sectionId, { ...existing, ...patch });
  return tryFirestore(
    () => updateDoc(doc(db, "classrooms", classroomId, "sections", sectionId, "quizzes", quizId), patch),
    () => queueWrite({ action: "updateQuiz", classroomId, sectionId, quizId, patch })
  );
}

export async function listQuizzes(classroomId, sectionId) {
  return tryFirestore(async () => {
    const snap = await getDocs(collection(db, "classrooms", classroomId, "sections", sectionId, "quizzes"));
    const quizzes = snap.docs.map(item => ({ id: item.id, classroomId, sectionId, ...item.data() }));
    quizzes.forEach(item => cacheQuiz(classroomId, sectionId, item));
    const localQuizzes = Object.values(getCollection("quizzes")).filter(item => item.classroomId === classroomId && item.sectionId === sectionId);
    return mergeById(quizzes, localQuizzes);
  }, () => Object.values(getCollection("quizzes")).filter(item => item.classroomId === classroomId && item.sectionId === sectionId));
}

export async function deleteQuiz(classroomId, sectionId, quizId) {
  deleteCollectionItem("quizzes", keyOf(classroomId, sectionId, quizId));
  return tryFirestore(
    () => deleteDoc(doc(db, "classrooms", classroomId, "sections", sectionId, "quizzes", quizId)),
    () => queueWrite({ action: "deleteQuiz", classroomId, sectionId, quizId })
  );
}

export async function saveGrade(classroomId, studentId, columnName, value) {
  const grade = {
    id: `${studentId}_${columnName}`,
    classroomId,
    studentId,
    columnName,
    value,
    updatedAt: Date.now()
  };
  cacheGrade(classroomId, grade);
  return tryFirestore(
    () => setDoc(doc(db, "classrooms", classroomId, "grades", grade.id), grade),
    () => queueWrite({ action: "setGrade", classroomId, grade })
  );
}

export async function listGrades(classroomId) {
  return tryFirestore(async () => {
    const snap = await getDocs(collection(db, "classrooms", classroomId, "grades"));
    const grades = snap.docs.map(item => ({ id: item.id, classroomId, ...item.data() }));
    grades.forEach(item => cacheGrade(classroomId, item));
    const localGrades = Object.values(getCollection("grades")).filter(item => item.classroomId === classroomId);
    return mergeById(grades, localGrades);
  }, () => Object.values(getCollection("grades")).filter(item => item.classroomId === classroomId));
}

export async function deleteGrade(classroomId, gradeId) {
  deleteCollectionItem("grades", keyOf(classroomId, gradeId));
  return tryFirestore(
    () => deleteDoc(doc(db, "classrooms", classroomId, "grades", gradeId)),
    () => queueWrite({ action: "deleteGrade", classroomId, gradeId })
  );
}

export async function createGradeColumn(classroomId, name) {
  const column = {
    id: localId("gradeColumn"),
    classroomId,
    name,
    createdAt: Date.now()
  };
  cacheGradeColumn(classroomId, column);
  return tryFirestore(async () => {
    await setDoc(doc(db, "classrooms", classroomId, "gradeColumns", column.id), column);
    return column;
  }, () => {
    queueWrite({ action: "setGradeColumn", classroomId, column });
    return column;
  });
}

export async function listGradeColumns(classroomId) {
  return tryFirestore(async () => {
    const snap = await getDocs(collection(db, "classrooms", classroomId, "gradeColumns"));
    const columns = snap.docs.map(item => ({ id: item.id, classroomId, ...item.data() }));
    columns.forEach(item => cacheGradeColumn(classroomId, item));
    const localColumns = Object.values(getCollection("gradeColumns")).filter(item => item.classroomId === classroomId);
    return mergeById(columns, localColumns);
  }, () => Object.values(getCollection("gradeColumns")).filter(item => item.classroomId === classroomId));
}

export async function updateGradeColumn(classroomId, columnId, patch) {
  const existing = getCollection("gradeColumns")[keyOf(classroomId, columnId)] || { id: columnId, classroomId };
  cacheGradeColumn(classroomId, { ...existing, ...patch });
  return tryFirestore(
    () => updateDoc(doc(db, "classrooms", classroomId, "gradeColumns", columnId), patch),
    () => queueWrite({ action: "updateGradeColumn", classroomId, columnId, patch })
  );
}

export async function deleteGradeColumn(classroomId, columnId) {
  deleteCollectionItem("gradeColumns", keyOf(classroomId, columnId));
  return tryFirestore(
    () => deleteDoc(doc(db, "classrooms", classroomId, "gradeColumns", columnId)),
    () => queueWrite({ action: "deleteGradeColumn", classroomId, columnId })
  );
}

export async function saveGradeCell(classroomId, studentId, columnId, columnName, value) {
  const grade = {
    id: `${studentId}_${columnId}`,
    classroomId,
    studentId,
    columnId,
    columnName,
    value,
    updatedAt: Date.now()
  };
  cacheGrade(classroomId, grade);
  return tryFirestore(
    () => setDoc(doc(db, "classrooms", classroomId, "grades", grade.id), grade),
    () => queueWrite({ action: "setGrade", classroomId, grade })
  );
}

export async function getClassroomOfflinePackage(classroomId) {
  const classroom = getCollection("classrooms")[classroomId] || (await getDoc(doc(db, "classrooms", classroomId))).data();
  const sections = await listSections(classroomId);
  const detailedSections = [];
  for (const section of sections) {
    detailedSections.push({
      ...section,
      resources: await listResources(classroomId, section.id),
      quizzes: await listQuizzes(classroomId, section.id)
    });
  }
  const participants = await listParticipants(classroomId);
  const grades = await listGrades(classroomId);
  const gradeColumns = await listGradeColumns(classroomId);
  const payload = {
    version: 1,
    exportedAt: Date.now(),
    classroom: { id: classroomId, ...classroom },
    sections: detailedSections,
    participants,
    gradeColumns,
    grades
  };
  setOfflineStore(store => ({
    ...store,
    hostedPackages: { ...(store.hostedPackages || {}), [classroomId]: payload }
  }));
  return payload;
}

export async function deleteStudentCourse(classroomId, studentId) {
  deleteCollectionItem("participants", keyOf(classroomId, studentId));
  Object.values(getCollection("sections"))
    .filter(item => item.classroomId === classroomId)
    .forEach(item => deleteCollectionItem("sections", keyOf(classroomId, item.id)));
  Object.values(getCollection("resources"))
    .filter(item => item.classroomId === classroomId)
    .forEach(item => deleteCollectionItem("resources", keyOf(classroomId, item.sectionId, item.id)));
  Object.values(getCollection("quizzes"))
    .filter(item => item.classroomId === classroomId)
    .forEach(item => deleteCollectionItem("quizzes", keyOf(classroomId, item.sectionId, item.id)));
  Object.values(getCollection("grades"))
    .filter(item => item.classroomId === classroomId && item.studentId === studentId)
    .forEach(item => deleteCollectionItem("grades", keyOf(classroomId, item.id)));
  setOfflineStore(store => {
    const connectedPackages = { ...(store.connectedPackages || {}) };
    delete connectedPackages[classroomId];
    return { ...store, connectedPackages };
  });
  return { ok: true };
}

export function importClassroomOfflinePackage(payload, student) {
  if (!payload?.classroom?.id) return { ok: false, message: "Invalid classroom package" };
  const classroom = payload.classroom;
  let joinedParticipant = null;
  cacheClassroom(classroom);
  (payload.sections || []).forEach(section => {
    cacheSection(classroom.id, section);
    (section.resources || []).forEach(resource => cacheResource(classroom.id, section.id, resource));
    (section.quizzes || []).forEach(quiz => cacheQuiz(classroom.id, section.id, quiz));
  });
  (payload.participants || []).forEach(participant => cacheParticipant(classroom.id, participant));
  (payload.gradeColumns || []).forEach(column => cacheGradeColumn(classroom.id, column));
  (payload.grades || []).forEach(grade => cacheGrade(classroom.id, grade));
  if (student) {
    const participant = {
      id: student.id,
      classroomId: classroom.id,
      studentId: student.id,
      name: student.name,
      email: student.email,
      joinedAt: Date.now()
    };
    joinedParticipant = participant;
    cacheParticipant(classroom.id, participant);
    queueWrite({ action: "setParticipant", classroomId: classroom.id, participant });
  }
  setOfflineStore(store => ({
    ...store,
    connectedPackages: { ...(store.connectedPackages || {}), [classroom.id]: payload }
  }));
  return { ok: true, classroom, participant: joinedParticipant };
}

export async function connectToTeacherHost(hostUrl, classroomId, student) {
  const cleanUrl = normalizeHostUrl(hostUrl);
  const cleanClassroomId = classroomId.trim();
  if (!cleanUrl || !cleanClassroomId) throw new Error("Enter teacher address and course ID.");
  const response = await retryLocalRequest(() => withTimeout(
    fetch(`${cleanUrl}/api/offline/classrooms/${cleanClassroomId}`),
    LOCAL_HOST_TIMEOUT_MS,
    "Still waiting for teacher group. Keep both phones on the EduMos Wi-Fi Direct group and do not close the app."
  ));
  if (!response.ok) throw new Error("Teacher group is not reachable. Check the address and course ID.");
  const payload = await response.json();
  payload.classroom = { ...payload.classroom, teacherHostUrl: cleanUrl };
  const result = importClassroomOfflinePackage(payload, student);
  result.stats = packageStats(payload);
  if (result.ok && result.participant) {
    try {
      await retryLocalRequest(() => submitParticipantToTeacherHost(cleanUrl, result.classroom.id, result.participant), 3, 1200);
      result.teacherSaved = true;
    } catch (error) {
      result.teacherSaved = false;
      result.teacherSaveMessage = error.message;
    }
  }
  return result;
}

export async function scanTeacherHosts(classroomId = "", extraHosts = []) {
  const hostCandidates = Array.from(new Set([
    ...extraHosts,
    ...(Object.values(getOfflineStore().teacherHostUrls || {})),
    ...COMMON_TEACHER_HOSTS
  ].map(normalizeHostUrl).filter(Boolean)));
  const cleanClassroomId = classroomId.trim();
  const found = [];

  await Promise.all(hostCandidates.map(async host => {
    try {
      if (cleanClassroomId) {
        const payload = await fetchClassroomPackage(host, cleanClassroomId);
        found.push({ hostUrl: host, payload, classroom: payload.classroom, stats: packageStats(payload) });
        return;
      }
      const response = await withTimeout(
        fetch(`${host}/api/offline/classrooms`),
        6000,
        "Teacher host scan timed out"
      );
      if (!response.ok) return;
      const data = await response.json();
      for (const classroom of data.classrooms || []) {
        found.push({
          hostUrl: host,
          classroom,
          stats: {
            sections: classroom.sections || 0,
            resources: classroom.resources || 0,
            quizzes: classroom.quizzes || 0
          }
        });
      }
    } catch (_error) {}
  }));

  return found;
}

export async function fetchTeacherHostSnapshot(hostUrl, classroomId, options = {}) {
  const cleanUrl = normalizeHostUrl(hostUrl);
  if (!cleanUrl || !classroomId) return null;
  const payload = await fetchClassroomPackage(cleanUrl, classroomId, "Could not refresh teacher group");
  payload.classroom = { ...payload.classroom, teacherHostUrl: cleanUrl };
  cacheClassroom(payload.classroom);
  (payload.sections || []).forEach(section => {
    cacheSection(classroomId, section);
    (section.resources || []).forEach(resource => cacheResource(classroomId, section.id, resource));
    (section.quizzes || []).forEach(quiz => cacheQuiz(classroomId, section.id, quiz));
  });
  const participants = payload.participants || [];
  participants.forEach(participant => {
    const studentId = participant.studentId || participant.id;
    cacheParticipant(classroomId, participant);
    if (options.queueForSync && studentId) {
      queueWrite({
        localId: `teacherHost_${classroomId}_participant_${studentId}`,
        action: "setParticipant",
        classroomId,
        participant: { ...participant, studentId, classroomId }
      });
    }
  });
  (payload.gradeColumns || []).forEach(column => cacheGradeColumn(classroomId, column));
  (payload.grades || []).forEach(grade => {
    const matchedStudentId = resolveStudentForGrade(grade, participants);
    const matchedGrade = matchedStudentId ? { ...grade, studentId: matchedStudentId } : grade;
    cacheGrade(classroomId, matchedGrade);
    if (options.queueForSync && grade.id) {
      queueWrite({
        localId: `teacherHost_${classroomId}_grade_${grade.id}`,
        action: "setGrade",
        classroomId,
        grade: { ...matchedGrade, classroomId }
      });
    }
  });
  return payload;
}

async function fetchClassroomPackage(hostUrl, classroomId, timeoutMessage = "Could not reach teacher group") {
  const cleanUrl = normalizeHostUrl(hostUrl);
  const response = await retryLocalRequest(() => withTimeout(
    fetch(`${cleanUrl}/api/offline/classrooms/${classroomId}`),
    LOCAL_HOST_TIMEOUT_MS,
    timeoutMessage
  ));
  if (!response.ok) throw new Error("Teacher group is not reachable");
  return response.json();
}

function packageStats(payload) {
  const sections = payload.sections || [];
  return {
    sections: sections.length,
    resources: sections.reduce((total, section) => total + (section.resources || []).length, 0),
    quizzes: sections.reduce((total, section) => total + (section.quizzes || []).length, 0)
  };
}

export async function submitParticipantToTeacherHost(hostUrl, classroomId, participant) {
  if (!hostUrl || !participant) return { ok: false };
  const cleanUrl = normalizeHostUrl(hostUrl);
  const response = await withTimeout(
    fetch(`${cleanUrl}/api/offline/classrooms/${classroomId}/participants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(participant)
    }),
    LOCAL_HOST_TIMEOUT_MS,
    "Could not join teacher group"
  );
  if (!response.ok) throw new Error("Could not save student in teacher group");
  return response.json();
}

export async function submitGradeToTeacherHost(hostUrl, classroomId, grade) {
  if (!hostUrl) return { ok: false };
  const cleanUrl = normalizeHostUrl(hostUrl);
  const response = await withTimeout(
    fetch(`${cleanUrl}/api/offline/classrooms/${classroomId}/grades`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(grade)
    }),
    LOCAL_HOST_TIMEOUT_MS,
    "Could not send grade to teacher host"
  );
  if (!response.ok) throw new Error("Could not send grade to teacher host");
  return response.json();
}

export async function publishClassroomToTeacherHost(hostUrl, classroomId, payload) {
  const cleanUrl = normalizeHostUrl(hostUrl);
  const response = await withTimeout(
    fetch(`${cleanUrl}/api/offline/classrooms/${classroomId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }),
    LOCAL_HOST_TIMEOUT_MS,
    "Could not publish classroom to local teacher host"
  );
  if (!response.ok) throw new Error("Could not publish classroom to local teacher host");
  return response.json();
}

export async function publishLiveQuestionToTeacherHost(hostUrl, classroomId, question) {
  const cleanUrl = normalizeHostUrl(hostUrl);
  const response = await withTimeout(
    fetch(`${cleanUrl}/api/live/classrooms/${classroomId}/question`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(question)
    }),
    LOCAL_HOST_TIMEOUT_MS,
    "Could not publish live question"
  );
  if (!response.ok) throw new Error("Could not publish live question");
  return response.json();
}

export async function fetchLiveQuestionFromTeacherHost(hostUrl, classroomId) {
  const cleanUrl = normalizeHostUrl(hostUrl);
  const response = await withTimeout(
    fetch(`${cleanUrl}/api/live/classrooms/${classroomId}/question`),
    LOCAL_HOST_TIMEOUT_MS,
    "Could not fetch live question"
  );
  if (!response.ok) throw new Error("Could not fetch live question");
  return response.json();
}

export async function submitLiveAnswerToTeacherHost(hostUrl, classroomId, answer) {
  const cleanUrl = normalizeHostUrl(hostUrl);
  const response = await withTimeout(
    fetch(`${cleanUrl}/api/live/classrooms/${classroomId}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(answer)
    }),
    LOCAL_HOST_TIMEOUT_MS,
    "Could not submit live answer"
  );
  if (!response.ok) throw new Error("Could not submit live answer");
  return response.json();
}

export async function fetchLiveAnswersFromTeacherHost(hostUrl, classroomId) {
  const cleanUrl = normalizeHostUrl(hostUrl);
  const response = await withTimeout(
    fetch(`${cleanUrl}/api/live/classrooms/${classroomId}/answers`),
    LOCAL_HOST_TIMEOUT_MS,
    "Could not fetch live answers"
  );
  if (!response.ok) throw new Error("Could not fetch live answers");
  return response.json();
}

function normalizeHostUrl(hostUrl) {
  const value = hostUrl.trim().replace(/\/$/, "");
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : `http://${value}`;
}

async function applyPendingWrite(write) {
  if (write.action === "setClassroom") {
    await setDoc(doc(db, "classrooms", write.classroom.id), write.classroom);
  }
  if (write.action === "deleteClassroom") {
    await deleteDoc(doc(db, "classrooms", write.classroomId));
  }
  if (write.action === "setParticipant") {
    await setDoc(doc(db, "classrooms", write.classroomId, "participants", write.participant.studentId), write.participant);
  }
  if (write.action === "deleteParticipant") {
    await deleteDoc(doc(db, "classrooms", write.classroomId, "participants", write.studentId));
  }
  if (write.action === "setSection") {
    await setDoc(doc(db, "classrooms", write.classroomId, "sections", write.section.id), write.section);
  }
  if (write.action === "deleteSection") {
    await deleteDoc(doc(db, "classrooms", write.classroomId, "sections", write.sectionId));
  }
  if (write.action === "setResource") {
    await setDoc(doc(db, "classrooms", write.classroomId, "sections", write.sectionId, "resources", write.resource.id), write.resource);
  }
  if (write.action === "deleteResource") {
    await deleteDoc(doc(db, "classrooms", write.classroomId, "sections", write.sectionId, "resources", write.resourceId));
  }
  if (write.action === "setQuiz") {
    await setDoc(doc(db, "classrooms", write.classroomId, "sections", write.sectionId, "quizzes", write.quiz.id), write.quiz);
  }
  if (write.action === "updateQuiz") {
    await updateDoc(doc(db, "classrooms", write.classroomId, "sections", write.sectionId, "quizzes", write.quizId), write.patch);
  }
  if (write.action === "deleteQuiz") {
    await deleteDoc(doc(db, "classrooms", write.classroomId, "sections", write.sectionId, "quizzes", write.quizId));
  }
  if (write.action === "setGrade") {
    await setDoc(doc(db, "classrooms", write.classroomId, "grades", write.grade.id), write.grade);
  }
  if (write.action === "deleteGrade") {
    await deleteDoc(doc(db, "classrooms", write.classroomId, "grades", write.gradeId));
  }
  if (write.action === "setGradeColumn") {
    await setDoc(doc(db, "classrooms", write.classroomId, "gradeColumns", write.column.id), write.column);
  }
  if (write.action === "updateGradeColumn") {
    await updateDoc(doc(db, "classrooms", write.classroomId, "gradeColumns", write.columnId), write.patch);
  }
  if (write.action === "deleteGradeColumn") {
    await deleteDoc(doc(db, "classrooms", write.classroomId, "gradeColumns", write.columnId));
  }
}

export async function syncPendingWrites() {
  if (!isOnline()) return { ok: false, pending: getOfflineStore().pendingWrites.length };
  const remaining = [];
  for (const write of getOfflineStore().pendingWrites || []) {
    try {
      await applyPendingWrite(write);
    } catch (_error) {
      remaining.push(write);
    }
  }
  replacePendingWrites(remaining);
  return { ok: true, pending: remaining.length };
}
