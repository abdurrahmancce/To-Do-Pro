# To-Do Pro

**English** | [বাংলা](#বাংলা)

An installable to-do app (PWA) that works on phone, laptop and PC. Tasks sync across devices, reminders ring even when the app is closed, and everything runs on free services.

**Live app:** https://abdurrahmancce.github.io/To-Do-Pro/
**User guide (English + বাংলা):** open `help.html` or *Account → Help* inside the app.

## Features
- Email + password login (sign in, create account, reset password), optional Google sign-in, optional guest mode
- Autosave on every change (online and offline), Trash with 30-day restore and 5-second undo
- Multi-device sync (Firebase Firestore) and offline support
- Smart quick-add (`Call mom tomorrow 6pm !high #family`), priorities, repeat, calendar, search
- Swipe actions, undo, bulk select, streaks, weekly summary, light/dark themes and accent colors
- Alarm sound with custom length, background push reminders (Firebase Cloud Messaging + Cloudflare Worker), heads-up and backup reminders, Done/Snooze from the notification
- Installable on Android, iPhone, Windows and Mac

## Quick start for users
1. Open the app and tap **Create account**. Enter name, email and a password (6+ characters).
2. Add tasks with **+**. Set a date, time and **Alarm** for reminders.
3. Sign in with the same email on your other devices to see the same tasks.
4. Turn on **Account → Background notifications** on each device for reminders when the app is closed.

## Setup for the owner (one time)
1. **Firebase:** follow `SETUP.md`, then paste the config into `firebase-config.js`.
2. **Enable email login:** Firebase Console → *Authentication* → *Sign-in method* → **Email/Password** → Enable → Save. (Add **Google** there too if you want the Google button.)
3. **Authorized domain:** *Authentication* → *Settings* → *Authorized domains* must include `abdurrahmancce.github.io`.
4. **Background push:** follow `PUSH-SETUP.md` (Cloudflare Worker).
5. Publish with GitHub Pages. After each update, bump `VERSION` in `sw.js` so installed apps refresh.

## Files
| File | Purpose |
|---|---|
| `index.html`, `style.css`, `script.js` | App UI and logic |
| `auth.js` | Animated email/password login screen  |
| `cloud.js` | Firebase Auth, Firestore sync and push |
| `help.html` | User guide (English + বাংলা) |
| `sw.js`, `manifest.webmanifest` | Offline cache, push, install |
| `worker/` | Cloudflare Worker that sends scheduled push reminders |

---

## বাংলা

ফোন, ল্যাপটপ ও পিসিতে চলা ইনস্টলযোগ্য টু-ডু অ্যাপ (PWA)। সব ডিভাইসে টাস্ক সিঙ্ক হয়, অ্যাপ বন্ধ থাকলেও রিমাইন্ডার বাজে, আর সবকিছু ফ্রি সার্ভিসে চলে।

**লাইভ অ্যাপ:** https://abdurrahmancce.github.io/To-Do-Pro/
**ব্যবহার নির্দেশিকা (English + বাংলা):** `help.html` খুলুন, অথবা অ্যাপের ভেতরে *Account → Help*।

### ফিচার
- ইমেইল + পাসওয়ার্ড লগইন (সাইন ইন, অ্যাকাউন্ট খোলা, পাসওয়ার্ড রিসেট), ঐচ্ছিক Google লগইন, ঐচ্ছিক গেস্ট মোড
- প্রতিটি পরিবর্তনে অটো সেভ (অনলাইন ও অফলাইন), ৩০ দিনের Trash ও ৫ সেকেন্ডের Undo
- একাধিক ডিভাইসে সিঙ্ক (Firebase Firestore) ও অফলাইন সাপোর্ট
- স্মার্ট কুইক-অ্যাড, প্রায়োরিটি, রিপিট, ক্যালেন্ডার, সার্চ, সোয়াইপ, স্ট্রিক, সাপ্তাহিক সারাংশ, লাইট/ডার্ক থিম
- অ্যালার্ম সাউন্ড, ব্যাকগ্রাউন্ড পুশ রিমাইন্ডার (Firebase Cloud Messaging + Cloudflare Worker), আগাম ও ব্যাকআপ রিমাইন্ডার, নোটিফিকেশন থেকেই Done/Snooze
- Android, iPhone, Windows ও Mac-এ ইনস্টল করা যায়

### ব্যবহারকারীর জন্য দ্রুত শুরু
1. অ্যাপ খুলে **অ্যাকাউন্ট খুলুন** চাপুন। নাম, ইমেইল ও পাসওয়ার্ড (কমপক্ষে ৬ অক্ষর) দিন।
2. **+** দিয়ে টাস্ক যোগ করুন। রিমাইন্ডারের জন্য তারিখ, সময় ও **Alarm** দিন।
3. অন্য ডিভাইসে একই ইমেইলে সাইন ইন করলে একই টাস্ক দেখবেন।
4. অ্যাপ বন্ধ থাকলেও রিমাইন্ডার পেতে প্রতিটি ডিভাইসে **Account → Background notifications** চালু করুন।

### মালিকের জন্য সেটআপ (একবার)
1. **Firebase:** `SETUP.md` অনুসরণ করে কনফিগ `firebase-config.js`-এ বসান।
2. **ইমেইল লগইন চালু করুন:** Firebase Console → *Authentication* → *Sign-in method* → **Email/Password** → Enable → Save।
3. **Authorized domain:** *Authentication* → *Settings* → *Authorized domains*-এ `abdurrahmancce.github.io` থাকতে হবে।
4. **ব্যাকগ্রাউন্ড পুশ:** `PUSH-SETUP.md` অনুসরণ করুন (Cloudflare Worker)।
5. GitHub Pages-এ পাবলিশ করুন। প্রতিটি আপডেটে `sw.js`-এর `VERSION` বাড়ান।