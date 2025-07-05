// =====================================================================
// 1. IMPORTS & FIREBASE SETUP
// =====================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { 
    getFirestore, collection, addDoc, serverTimestamp,
    query, orderBy, onSnapshot, doc, updateDoc, increment
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// =====================================================================
// 2. CONSTANTS & STATE
// =====================================================================
const MAX_WORDS = 200;
const MAX_CHARS = 1200;
const POST_COOLDOWN_SECONDS = 300; // MODIFIED: Cooldown increased to 5 minutes
const reportingInProgress = new Set();
// --- HTML Element References
const postContent = document.getElementById('post-content');
const shareButton = document.getElementById('share-button');
const postFeed = document.getElementById('post-feed');
const charCounter = document.getElementById('char-counter');
const feedbackMessage = document.getElementById('feedback-message');
const themeToggleButton = document.getElementById('theme-toggle-button');
const feedbackModalOverlay = document.getElementById('feedback-modal-overlay');
const openFeedbackLink = document.getElementById('open-feedback-modal');
const closeModalButton = document.getElementById('close-modal-button');
const feedbackForm = document.getElementById('feedback-form');
const feedbackFormStatus = document.getElementById('feedback-form-status');

// =====================================================================
// 3. THEME MANAGEMENT & MODAL
// =====================================================================
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    themeToggleButton.textContent = theme === 'dark' ? '☀️' : '🌙';
}
function initializeTheme() {
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme) applyTheme(savedTheme);
    else if (systemPrefersDark) applyTheme('dark');
    else applyTheme('light');
}
function openModal() { feedbackModalOverlay.classList.add('open'); }
function closeModal() { feedbackModalOverlay.classList.remove('open'); }
async function handleFeedbackSubmission(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Submitting...';
    const formData = new FormData(e.target);
    try {
        await addDoc(collection(db, 'feedback'), { type: formData.get('feedbackType'), message: formData.get('feedbackText'), timestamp: serverTimestamp(), userAgent: navigator.userAgent });
        feedbackFormStatus.textContent = "Thank you! Your feedback has been sent.";
        e.target.reset();
        setTimeout(() => { closeModal(); feedbackFormStatus.textContent = ""; }, 2000);
    } catch (error) {
        console.error("Error submitting feedback: ", error);
        feedbackFormStatus.textContent = "Error. Please try again.";
    } finally {
        btn.disabled = false; btn.textContent = 'Submit';
    }
}

// =====================================================================
// 4. CORE APPLICATION LOGIC
// =====================================================================
function showFeedback(message, type = 'error', duration = 4000) {
    feedbackMessage.textContent = message;
    feedbackMessage.className = `feedback-message ${type}`;
    if (duration > 0) {
      setTimeout(() => { feedbackMessage.textContent = ''; feedbackMessage.className = 'feedback-message'; }, duration);
    }
}

async function handlePostSubmission(event) {
    event.preventDefault();
    const lastPostTime = localStorage.getItem('lastPostTimestamp');
    if (lastPostTime && (Date.now() - parseInt(lastPostTime)) / 1000 < POST_COOLDOWN_SECONDS) {
        const secondsRemaining = Math.ceil(POST_COOLDOWN_SECONDS - (Date.now() - parseInt(lastPostTime)) / 1000);
        showFeedback(`Please wait ${secondsRemaining}s to post again.`, 'error');
        return;
    }
    const contentToSubmit = postContent.value.trim();
    const wordCount = contentToSubmit.split(/\s+/).filter(Boolean).length;
    if (contentToSubmit === '') { showFeedback("You can't share an empty thought!", 'error'); return; }
    if (wordCount > MAX_WORDS) { showFeedback(`Post exceeds the ${MAX_WORDS}-word limit.`, 'error'); return; }

    postContent.value = '';
    document.getElementById('char-counter').textContent = `0 / ${MAX_CHARS}`;
    shareButton.disabled = true;
    shareButton.textContent = "Sharing...";
    showFeedback("Sharing your thought...", 'success', 0);

    try {
        await addDoc(collection(db, 'posts'), { content: contentToSubmit, timestamp: serverTimestamp(), reportCount: 0 });
        localStorage.setItem('lastPostTimestamp', Date.now().toString());
        showFeedback('Your post was shared!', 'success');
    } catch (error) {
        console.error("Error adding document: ", error);
        showFeedback("Error sharing post. Your text is restored.", 'error');
        postContent.value = contentToSubmit;
    } finally {
        shareButton.disabled = false;
        shareButton.textContent = "Share Anonymously";
    }
}

function listenForPosts() {
    const q = query(collection(db, 'posts'), orderBy('timestamp', 'desc'));
    onSnapshot(q, (snapshot) => {
        const feed = document.getElementById('post-feed');
        if (snapshot.empty) { feed.innerHTML = `<p class="feed-status">No thoughts shared yet. Be the first!</p>`; return; }
        feed.innerHTML = '';
        const reportedPosts = JSON.parse(localStorage.getItem('reportedPosts')) || [];
        snapshot.forEach((doc) => {
            const postData = doc.data();
            const postId = doc.id;
            if (postData.reportCount < 3 && !reportedPosts.includes(postId)) {
                const card = document.createElement('div');
                card.className = 'post-card';
                card.innerHTML = `<button class="report-button" data-id="${postId}" aria-label="Report post">Report</button><p></p>`;
                card.querySelector('p').textContent = postData.content;
                feed.appendChild(card);
            }
        });
    }, (error) => {
        console.error("Error listening: ", error);
        document.getElementById('post-feed').innerHTML = `<p class="feed-status">Could not fetch posts.</p>`;
    });
}
async function handleReportClick(e) {
    if (!e.target.classList.contains('report-button')) return;
    const btn = e.target;
    const postId = btn.dataset.id;
    if (reportingInProgress.has(postId)) return;
    reportingInProgress.add(postId);
    btn.disabled = true; btn.textContent = 'Reported';
    try {
        await updateDoc(doc(db, 'posts', postId), { reportCount: increment(1) });
        const reported = JSON.parse(localStorage.getItem('reportedPosts')) || [];
        if (!reported.includes(postId)) { reported.push(postId); localStorage.setItem('reportedPosts', JSON.stringify(reported)); }
        btn.closest('.post-card').classList.add('hidden');
    } catch (error) {
        console.error("Error reporting:", error);
        btn.disabled = false; btn.textContent = 'Report';
    } finally {
        reportingInProgress.delete(postId);
    }
}

// =====================================================================
// 5. INITIALIZATION & EVENT LISTENERS
// =====================================================================
document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    listenForPosts();
    
    document.getElementById('post-form').addEventListener('submit', handlePostSubmission);
    postFeed.addEventListener('click', handleReportClick);
    themeToggleButton.addEventListener('click', () => applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'));
    openFeedbackLink.addEventListener('click', (e) => { e.preventDefault(); openModal(); });
    closeModalButton.addEventListener('click', closeModal);
    feedbackModalOverlay.addEventListener('click', (e) => { if (e.target === feedbackModalOverlay) closeModal(); });
    feedbackForm.addEventListener('submit', handleFeedbackSubmission);
    
    // REVERTED: Keydown listener for classic text composition
    postContent.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (!shareButton.disabled) {
                // Manually trigger the form submission to run all logic
                document.getElementById('post-form').requestSubmit();
            }
        }
    });
});