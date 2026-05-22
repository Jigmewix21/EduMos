import { initializeApp } from "firebase/app";
import { addDoc, collection, getDocs, getFirestore, limit, query, where } from "firebase/firestore";
import dotenv from "dotenv";

dotenv.config();

const app = initializeApp({
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID
});

const db = getFirestore(app);

async function seedOnce(collectionName, email, data) {
  const existing = await getDocs(query(collection(db, collectionName), where("email", "==", email), limit(1)));
  if (!existing.empty) {
    console.log(`${collectionName}: ${email} already exists`);
    return;
  }

  await addDoc(collection(db, collectionName), data);
  console.log(`${collectionName}: created ${email}`);
}

await seedOnce("students", "student1@gmail.com", {
  name: "Student One",
  email: "student1@gmail.com",
  password: "student123",
  createdAt: Date.now()
});

await seedOnce("teachers", "teacher@edumos.com", {
  name: "EduMos Teacher",
  email: "teacher@edumos.com",
  password: "teacher123",
  createdAt: Date.now()
});

console.log("Firebase seed complete");
