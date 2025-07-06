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
const POST_COOLDOWN_SECONDS = 300; // 5 minutes
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
    const feedbackType = formData.get('feedbackType');
    
    const collectionName = feedbackType === 'bug' ? 'bug-reports' : 'feature-suggestions';

    try {
        await addDoc(collection(db, collectionName), { 
            message: formData.get('feedbackText'), 
            timestamp: serverTimestamp(), 
            userAgent: navigator.userAgent 
        });
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

// [UPDATED] This function now formats the timestamp into an absolute date and time.
function formatTimestamp(timestamp) {
    if (!timestamp) return ''; // Return empty string if timestamp is null
    
    const postDate = timestamp.toDate();

    const dateOptions = {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    };
    
    const timeOptions = {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    };

    const formattedDate = postDate.toLocaleDateString('en-US', dateOptions);
    const formattedTime = postDate.toLocaleTimeString('en-US', timeOptions);

    return `${formattedDate} at ${formattedTime}`;
}

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
    charCounter.textContent = `0 / ${MAX_CHARS}`;
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
        charCounter.textContent = `${contentToSubmit.length} / ${MAX_CHARS}`;
    } finally {
        shareButton.disabled = false;
        shareButton.textContent = "Share Anonymously";
    }
}

function listenForPosts() {
    const q = query(collection(db, 'posts'), orderBy('timestamp', 'desc'));
    onSnapshot(q, (snapshot) => {
        const feed = document.getElementById('post-feed');
        if (snapshot.empty) {
            feed.innerHTML = `<p class="feed-status">No thoughts shared yet. Be the first!</p>`;
            return;
        }

        feed.innerHTML = '';
        const reportedPosts = JSON.parse(localStorage.getItem('reportedPosts')) || [];

        snapshot.forEach((doc) => {
            const postData = doc.data();
            const postId = doc.id;

            if (postData.reportCount < 3) {
                const card = document.createElement('div');
                card.className = 'post-card';

                const reportButton = document.createElement('button');
                reportButton.className = 'report-button';
                reportButton.dataset.id = postId;
                reportButton.setAttribute('aria-label', 'Report post');
                
                const contentP = document.createElement('p');
                contentP.textContent = postData.content;

                const timestampSpan = document.createElement('span');
                timestampSpan.className = 'post-timestamp';
                timestampSpan.textContent = formatTimestamp(postData.timestamp);

                if (reportedPosts.includes(postId)) {
                    reportButton.disabled = true;
                    reportButton.textContent = 'Reported';
                } else {
                    reportButton.disabled = false;
                    reportButton.textContent = 'Report';
                }
                
                card.appendChild(reportButton);
                card.appendChild(contentP);
                card.appendChild(timestampSpan);
                feed.appendChild(card);
            }
        });
    }, (error) => {
        console.error("Error listening: ", error);
        document.getElementById('post-feed').innerHTML = `<p class="feed-status">Could not fetch posts.</p>`;
    });
}

function handleReportClick(e) {
    if (!e.target.classList.contains('report-button')) return;
    const btn = e.target;
    const postId = btn.dataset.id;
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Reported';
    const reportedPosts = JSON.parse(localStorage.getItem('reportedPosts')) || [];
    if (!reportedPosts.includes(postId)) {
        reportedPosts.push(postId);
        localStorage.setItem('reportedPosts', JSON.stringify(reportedPosts));
    }
    updateDoc(doc(db, 'posts', postId), { reportCount: increment(1) })
        .catch(error => {
            console.error("Error reporting post: ", error);
            btn.disabled = false;
            btn.textContent = 'Report';
            const updatedReportedPosts = reportedPosts.filter(id => id !== postId);
            localStorage.setItem('reportedPosts', JSON.stringify(updatedReportedPosts));
            showFeedback('Could not report post. Please try again.', 'error');
        });
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
    
    postContent.addEventListener('input', () => {
        const currentLength = postContent.value.length;
        charCounter.textContent = `${currentLength} / ${MAX_CHARS}`;
    });
    
    postContent.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (!shareButton.disabled) {
                document.getElementById('post-form').requestSubmit();
            }
        }
    });
});