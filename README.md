# HearMeOuttt 🗣️

A simple and anonymous web app where anyone can share their thoughts, daily experiences, or anything they want to express — without needing an account. Whether you're feeling happy, confused, thoughtful, or just want to speak out, **HearMeOuttt** gives you a place to be heard, judgment-free.

This is a solo project built by [Harsh Vardhan Shukla](https://github.com/Harshvdev) to practice and improve frontend and Firebase development skills.

> 💬 This isn't just a confession site — you're free to share your daily experiences, thoughts, ideas, or feelings anonymously. Confessions are welcome too, as long as they follow the community rules.

🛡️ Please keep posts respectful and avoid sharing anything illegal, harmful, or offensive. This is a public space, and we want to keep it safe for everyone.

---

## 🔗 Live Preview

🌍 [Try It Here](https://hearmeouttt.netlify.app)

📂 [Source Code on GitHub](https://github.com/Harshvdev/HearMeOut)

---

## ✨ Features

- ✅ Share posts anonymously with word and character limits
- 🌙 Dark mode toggle
- 🧠 Smart cooldown (prevents post spam for 5 minutes per user)
- 🚨 Report system (posts with 3+ reports are hidden)
- 📅 Shows human-readable timestamps on each post
- 💬 Real-time feed (auto-refresh using Firestore)
- 🛠️ Feedback modal to report bugs or suggest features
- 🔒 All post/report actions are local and anonymous
- 📱 Mobile responsive and fast

---

## 🧰 Built With

- **HTML, CSS & JavaScript (Vanilla)**
- **Firebase Firestore** for backend
- **Netlify Hosting**
- **Modular Firebase SDK (v9+)**
- Modern CSS with `:root` variables and dark mode support
- Smooth UX with live feedback and accessibility labels

---

## 🚀 How to Run It Locally (Optional for Devs)

> **Note:** You don’t need this if you're just a user. This is for devs who want to test or learn from the code.

1. Clone the repo  
   ```bash
   git clone https://github.com/Harshvdev/HearMeOut.git
   cd HearMeOut
   ```

2. Install dependencies  
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory and add your Firebase config:
   ```
   VITE_API_KEY=your_api_key
   VITE_AUTH_DOMAIN=your_auth_domain
   VITE_PROJECT_ID=your_project_id
   VITE_STORAGE_BUCKET=your_storage_bucket
   VITE_MESSAGING_SENDER_ID=your_sender_id
   VITE_APP_ID=your_app_id
   ```

4. Start the local server  
   ```bash
   npm run dev
   ```

5. Or just open `index.html` directly in a browser (Firebase features won't work without config).

---

## 🙋‍♂️ Creator

**Harsh Vardhan Shukla**  
🌐 [GitHub](https://github.com/Harshvdev)  
📬 Open to feedback, suggestions, or collaboration ideas.

---

## 🛡️ License and Usage Terms

This project was developed entirely by **Harsh Vardhan Shukla** as part of a self-learning journey using open tools and AI assistance.

> **This is not an open-source project.**

### ❌ You may not:
- Use this code or idea for **commercial purposes** without permission
- Publish a clone of this project publicly without credit
- Claim this work as your own or redistribute it without attribution

The code is public only for learning, inspiration, and transparency. If you'd like to collaborate or license it for another use, contact me.

```
© 2025 Harsh Vardhan Shukla. All rights reserved.
```

---

## 🧠 Note to Developers & Viewers

I'm still a beginner, learning from scratch through real projects. This was made with the help of AI, The Odin Project, and community docs. Every part was customized, debugged, and understood step-by-step — not blindly copied. ❤️

Please be respectful of the effort and treat this work ethically.
