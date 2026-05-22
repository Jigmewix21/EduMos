# EduMos Web2

This is the React Native + Expo version of EduMos.

It is designed for:

- **Frontend:** Expo web hosted on Vercel
- **Database:** Firebase Firestore
- **Backend:** Node/Express backend hosted on Render

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and add Firebase web app config.

3. Run locally:

```bash
npm run web
```

## Expo Go On Phone

Use `npm.cmd` on Windows if PowerShell blocks `npm`.

```powershell
cd C:\project_EduMos\Web2
npm.cmd run expo:tunnel
```

If tunnel is slow or blocked by your network, use LAN mode while your laptop and phone are on the same Wi-Fi:

```powershell
npm.cmd run expo:lan
```

If Expo cache causes trouble:

```powershell
npm.cmd run expo:clear
```

Then scan the QR code with Expo Go.

4. Build for Vercel:

```bash
npm run build:web
```

## Firebase

Create a Firebase project at https://firebase.google.com and enable Firestore.

Collections used:

- `students`
- `teachers`
- `classrooms`
- `classrooms/{classroomId}/participants`
- `classrooms/{classroomId}/sections`
- `classrooms/{classroomId}/sections/{sectionId}/resources`
- `classrooms/{classroomId}/sections/{sectionId}/quizzes`
- `classrooms/{classroomId}/grades`

Seed these demo users:

```bash
npm run seed:firebase
```

This creates:

```json
```json
{
  "name": "Student One",
  "email": "student1@gmail.com",
  "password": "student123"
}

{
  "name": "EduMos Teacher",
  "email": "teacher@edumos.com",
  "password": "teacher123"
}
```

For production, replace plain password login with Firebase Authentication.

## Vercel

Import `Web2` as a Vercel project and set the environment variables from `.env.example`.

Build command:

```bash
npm run build:web
```

Output directory:

```bash
dist
```

## Render Backend

The backend is in `Web2/backend`. Deploy that folder as a Render Web Service.

## Offline Website + APK

See `DEPLOYMENT-OFFLINE.md` for the Vercel, Firebase, Render, Android APK, and teacher hotspot workflow.
"# EduMus" 
