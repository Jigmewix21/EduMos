# EduMos Deployment And Offline APK Notes

EduMos now uses one React Native + Expo codebase for:

- Vercel web app: global website and browser app.
- Firebase Firestore: online database.
- Render backend: online API plus local teacher hotspot hub when run on a teacher device.
- Android APK: teacher/student app with persistent offline storage through Expo SQLite.

## Web App On Vercel

Set these environment variables in Vercel from `.env.example`.

```bash
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=
EXPO_PUBLIC_API_BASE_URL=https://your-render-backend.onrender.com
```

Vercel settings:

```bash
Build command: npm run build:web
Output directory: dist
```

## Backend On Render

Deploy the `backend` folder as a Render web service.

Required Firebase Admin variables on Render:

```bash
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
FRONTEND_ORIGIN=https://your-vercel-domain.vercel.app
```

## Android APK

Use EAS Build for the APK.

```bash
npx expo install
npx eas build:configure
npx eas build --platform android --profile preview
```

The APK keeps offline classroom data, resources metadata, gradebook edits, quiz submissions, and pending sync records in SQLite.

## Teacher Hotspot Mode

Browsers and APKs cannot create a Wi-Fi hotspot by themselves. The teacher turns on the phone/laptop hotspot in device settings. For student devices to submit data to the teacher while offline, the teacher device must run the local backend.

On the teacher laptop:

```bash
cd backend
npm install
npm run dev
```

Students connect to the teacher hotspot and use the teacher device IP, for example:

```bash
http://192.168.43.1:10000
```

In the teacher classroom, press `Host`. In the student dashboard, use `Connect To Teacher Host` with the teacher URL and course ID.

When internet returns, press `Sync` in the app or call the backend sync endpoint so offline grades are written to Firebase.
