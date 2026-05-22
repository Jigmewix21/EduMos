import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import admin from "firebase-admin";
import fs from "node:fs/promises";
import path from "node:path";

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const offlineFile = path.join(process.cwd(), "offline-hub-data.json");

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "*" }));
app.use(express.json({ limit: "2mb" }));

async function readOfflineHub() {
  try {
    return JSON.parse(await fs.readFile(offlineFile, "utf8"));
  } catch (_error) {
    return { classrooms: {}, grades: {}, gradeColumns: {} };
  }
}

async function writeOfflineHub(data) {
  await fs.writeFile(offlineFile, JSON.stringify(data, null, 2));
}

if (!admin.apps.length && process.env.FIREBASE_PROJECT_ID) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
    })
  });
}

app.get("/", (_req, res) => {
  res.json({ ok: true, name: "EduMos Web2 Backend" });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, timestamp: Date.now() });
});

app.post("/api/sync", async (req, res) => {
  if (!admin.apps.length) {
    res.status(500).json({ ok: false, message: "Firebase Admin is not configured" });
    return;
  }

  const db = admin.firestore();
  const { collectionName, payload } = req.body;

  if (!collectionName || !payload) {
    res.status(400).json({ ok: false, message: "collectionName and payload are required" });
    return;
  }

  const ref = await db.collection(collectionName).add({
    ...payload,
    syncedAt: Date.now()
  });

  res.json({ ok: true, id: ref.id });
});

app.post("/api/offline/classrooms/:classroomId", async (req, res) => {
  const { classroomId } = req.params;
  const payload = req.body;

  if (!payload?.classroom?.id) {
    res.status(400).json({ ok: false, message: "A classroom package is required" });
    return;
  }

  const hub = await readOfflineHub();
  hub.classrooms[classroomId] = payload;
  hub.grades[classroomId] = hub.grades[classroomId] || {};
  hub.gradeColumns[classroomId] = hub.gradeColumns[classroomId] || {};
  for (const column of payload.gradeColumns || []) {
    hub.gradeColumns[classroomId][column.id] = column;
  }
  await writeOfflineHub(hub);

  res.json({ ok: true, classroomId, url: `/api/offline/classrooms/${classroomId}` });
});

app.get("/api/offline/classrooms/:classroomId", async (req, res) => {
  const { classroomId } = req.params;
  const hub = await readOfflineHub();
  const payload = hub.classrooms[classroomId];

  if (!payload) {
    res.status(404).json({ ok: false, message: "Classroom is not hosted on this device" });
    return;
  }

  res.json({
    ...payload,
    gradeColumns: Object.values(hub.gradeColumns[classroomId] || payload.gradeColumns || {}),
    grades: Object.values(hub.grades[classroomId] || payload.grades || {})
  });
});

app.post("/api/offline/classrooms/:classroomId/grades", async (req, res) => {
  const { classroomId } = req.params;
  const grade = req.body;

  if (!grade?.studentId || !grade?.columnName) {
    res.status(400).json({ ok: false, message: "studentId and columnName are required" });
    return;
  }

  const hub = await readOfflineHub();
  hub.grades[classroomId] = hub.grades[classroomId] || {};
  const id = grade.id || `${grade.studentId}_${grade.columnName}`;
  hub.grades[classroomId][id] = {
    ...grade,
    id,
    classroomId,
    receivedAt: Date.now()
  };
  await writeOfflineHub(hub);

  res.json({ ok: true, id });
});

app.post("/api/offline/sync", async (_req, res) => {
  if (!admin.apps.length) {
    res.status(500).json({ ok: false, message: "Firebase Admin is not configured" });
    return;
  }

  const hub = await readOfflineHub();
  const db = admin.firestore();
  let syncedGrades = 0;
  let syncedColumns = 0;

  for (const [classroomId, columns] of Object.entries(hub.gradeColumns || {})) {
    for (const [columnId, column] of Object.entries(columns)) {
      await db.collection("classrooms").doc(classroomId).collection("gradeColumns").doc(columnId).set({
        ...column,
        syncedAt: Date.now()
      });
      syncedColumns += 1;
    }
  }

  for (const [classroomId, grades] of Object.entries(hub.grades || {})) {
    for (const [gradeId, grade] of Object.entries(grades)) {
      await db.collection("classrooms").doc(classroomId).collection("grades").doc(gradeId).set({
        ...grade,
        syncedAt: Date.now()
      });
      syncedGrades += 1;
    }
  }

  res.json({ ok: true, syncedColumns, syncedGrades });
});

app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ ok: false, message: "No file uploaded" });
    return;
  }

  res.json({
    ok: true,
    file: {
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size
    },
    note: "Connect this endpoint to Firebase Storage or another file store for production files."
  });
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`EduMos Web2 backend running on port ${port}`);
});
