export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || "AIzaSyAsTUSngdE9RcYSFivyAtnXh_vTyqthiEc",
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || "edumus-74f0c.firebaseapp.com",
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "edumus-74f0c",
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || "edumus-74f0c.firebasestorage.app",
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "315499781149",
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || "1:315499781149:web:b9e9525def5587b5b6baf4"
};

export const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || "https://edumos-backend.onrender.com";
