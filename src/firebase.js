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
import { firebaseConfig } from "./config";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

if (typeof globalThis !== "undefined" && typeof window !== "undefined" && typeof document !== "undefined") {
  enableIndexedDbPersistence(db).catch(() => {});
}

const keyOf = (...parts) => parts.join("__");
const localId = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const FIREBASE_TIMEOUT_MS = 10000;
const LOCAL_HOST_TIMEOUT_MS = 12000;

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ]);
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
    return classrooms;
  }, () => Object.values(getCollection("classrooms")).filter(item => item.teacherId === teacherId));
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
    for (const item of all.docs) {
      const classroom = { id: item.id, ...item.data() };
      cacheClassroom(classroom);
      const participant = await getDoc(doc(db, "classrooms", item.id, "participants", studentId));
      if (participant.exists()) {
        cacheParticipant(item.id, { id: studentId, classroomId: item.id, ...participant.data() });
        results.push(classroom);
      }
    }
    return results;
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
    return participants;
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
    return sections;
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
    return resources;
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
    return quizzes;
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
    return grades;
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
    return columns;
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

export function importClassroomOfflinePackage(payload, student) {
  if (!payload?.classroom?.id) return { ok: false, message: "Invalid classroom package" };
  const classroom = payload.classroom;
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
    cacheParticipant(classroom.id, participant);
    queueWrite({ action: "setParticipant", classroomId: classroom.id, participant });
  }
  setOfflineStore(store => ({
    ...store,
    connectedPackages: { ...(store.connectedPackages || {}), [classroom.id]: payload }
  }));
  return { ok: true, classroom };
}

export async function connectToTeacherHost(hostUrl, classroomId, student) {
  const cleanUrl = normalizeHostUrl(hostUrl);
  const cleanClassroomId = classroomId.trim();
  if (!cleanUrl || !cleanClassroomId) throw new Error("Enter teacher address and course ID.");
  const response = await withTimeout(
    fetch(`${cleanUrl}/api/offline/classrooms/${cleanClassroomId}`),
    LOCAL_HOST_TIMEOUT_MS,
    "Could not reach teacher group. Check that both phones are on the same hotspot and the teacher pressed Host Group."
  );
  if (!response.ok) throw new Error("Teacher group is not reachable. Check the address and course ID.");
  const payload = await response.json();
  payload.classroom = { ...payload.classroom, teacherHostUrl: cleanUrl };
  return importClassroomOfflinePackage(payload, student);
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

function normalizeHostUrl(hostUrl) {
  const value = hostUrl.trim().replace(/\/$/, "");
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : `http://${value}`;
}

async function applyPendingWrite(write) {
  if (write.action === "setClassroom") {
    await setDoc(doc(db, "classrooms", write.classroom.id), write.classroom);
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
