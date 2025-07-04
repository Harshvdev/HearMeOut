// =====================================================================
// 1. IMPORTS
// =====================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { 
    getFirestore, collection, addDoc, serverTimestamp,
    query, orderBy, onSnapshot, doc, updateDoc, increment
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

// =====================================================================
// 2. FIREBASE SETUP
// =====================================================================
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
// 3. CONSTANTS & STATE
// =====================================================================
const MAX_WORDS = 200;
const MAX_CHARS = 1200;
const POST_COOLDOWN_SECONDS = 60;

// --- HTML Element References
const postForm = document.getElementById('post-form');
const postContent = document.getElementById('post-content');
const shareButton = document.getElementById('share-button');
const postFeed = document.getElementById('post-feed');
const charCounter = document.getElementById('char-counter');
const feedbackMessage = document.getElementById('feedback-message');

// --- In-Memory State
const reportingInProgress = new Set();

// =====================================================================
// 4. FUNCTION DEFINITIONS (All functions from previous step are unchanged)
// =====================================================================

function showFeedback(message, type = 'error', duration = 3000) {
    feedbackMessage.textContent = message;
    feedbackMessage.className = `feedback-message ${type}`;
    setTimeout(() => {
        feedbackMessage.textContent = '';
        feedbackMessage.className = 'feedback-message';
    }, duration);
}

function updateCharCounter() {
    const count = postContent.value.length;
    charCounter.textContent = `${count} / ${MAX_CHARS}`;
    charCounter.classList.toggle('limit-near', count > MAX_CHARS * 0.9);
    charCounter.classList.toggle('limit-exceeded', count > MAX_CHARS);
}

function setFeedStatus(message) {
    postFeed.innerHTML = `<p class="feed-status">${message}</p>`;
}

function getReportedPostsFromStorage() {
    const reported = localStorage.getItem('reportedPosts');
    return reported ? JSON.parse(reported) : [];
}

function addPostToReportedStorage(postId) {
    const reportedPosts = getReportedPostsFromStorage();
    if (!reportedPosts.includes(postId)) {
        reportedPosts.push(postId);
        localStorage.setItem('reportedPosts', JSON.stringify(reportedPosts));
    }
}

async function handlePostSubmission(event) {
    event.preventDefault();
    const lastPostTime = localStorage.getItem('lastPostTimestamp');
    if (lastPostTime) {
        const secondsSinceLastPost = (Date.now() - parseInt(lastPostTime)) / 1000;
        if (secondsSinceLastPost < POST_COOLDOWN_SECONDS) {
            const secondsRemaining = Math.ceil(POST_COOLDOWN_SECONDS - secondsSinceLastPost);
            showFeedback(`Please wait ${secondsRemaining}s to post again.`, 'error');
            return;
        }
    }
    const content = postContent.value.trim();
    const wordCount = content.split(/\s+/).filter(word => word.length > 0).length;
    if (content === '') {
        showFeedback("You can't share an empty thought!", 'error');
        return;
    }
    if (wordCount > MAX_WORDS) {
        showFeedback(`Post exceeds the ${MAX_WORDS}-word limit.`, 'error');
        return;
    }
    shareButton.disabled = true;
    shareButton.textContent = "Sharing...";
    try {
        await addDoc(collection(db, 'posts'), {
            content: content,
            timestamp: serverTimestamp(),
            reportCount: 0
        });
        postContent.value = '';
        updateCharCounter();
        showFeedback('Your post was shared!', 'success');
        localStorage.setItem('lastPostTimestamp', Date.now().toString());
    } catch (error) {
        console.error("Error adding document: ", error);
        showFeedback("Error sharing your post. Try again.", 'error');
    } finally {
        shareButton.disabled = false;
        shareButton.textContent = "Share Anonymously";
    }
}

async function handleReportClick(event) {
    const button = event.target;
    if (!button.classList.contains('report-button') || button.disabled) return;
    const postId = button.dataset.id;
    const postCard = button.closest('.post-card');
    if (reportingInProgress.has(postId)) return;
    reportingInProgress.add(postId);
    button.disabled = true;
    button.textContent = "Reported";
    try {
        const postRef = doc(db, 'posts', postId);
        await updateDoc(postRef, { reportCount: increment(1) });
        addPostToReportedStorage(postId);
        postCard.classList.add('hidden');
        setTimeout(() => postCard.remove(), 300);
    } catch (error) {
        console.error("Error reporting post: ", error);
        button.disabled = false;
        button.textContent = "Report";
        showFeedback("Failed to report post. Please try again.", 'error');
    } finally {
        reportingInProgress.delete(postId);
    }
}

function createPostCard(postData, postId) {
    const reportedPostsLocally = getReportedPostsFromStorage();
    if (reportedPostsLocally.includes(postId) || postData.reportCount >= 3) {
        return null;
    }
    const card = document.createElement('div');
    card.classList.add('post-card');
    card.dataset.postId = postId;
    const reportButton = document.createElement('button');
    reportButton.classList.add('report-button');
    reportButton.textContent = 'Report';
    reportButton.dataset.id = postId;
    reportButton.setAttribute('aria-label', `Report post starting with: ${postData.content.substring(0, 20)}`);
    if (reportingInProgress.has(postId)) {
        reportButton.disabled = true;
        reportButton.textContent = "Reported";
    }
    const contentP = document.createElement('p');
    contentP.textContent = postData.content;
    card.appendChild(reportButton);
    card.appendChild(contentP);
    return card;
}

function listenForPosts() {
    const q = query(collection(db, 'posts'), orderBy('timestamp', 'desc'));
    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            setFeedStatus("No thoughts shared yet. Be the first!");
            return;
        }
        postFeed.innerHTML = '';
        snapshot.forEach((doc) => {
            const postCardElement = createPostCard(doc.data(), doc.id);
            if (postCardElement) {
                postFeed.appendChild(postCardElement);
            }
        });
    }, (error) => {
        console.error("Error listening to post updates: ", error);
        setFeedStatus("Could not fetch posts. Please check your connection and try again later.");
    });
}

// =====================================================================
// 5. SCRIPT EXECUTION
// =====================================================================
document.addEventListener('DOMContentLoaded', () => {
    setFeedStatus("Loading thoughts...");
    listenForPosts();

    postForm.addEventListener('submit', handlePostSubmission);
    postContent.addEventListener('input', updateCharCounter);
    postFeed.addEventListener('click', handleReportClick);

    // --- REPLACED: Keydown listener with new chat-style logic ---
    postContent.addEventListener('keydown', (event) => {
        // If the user presses Shift + Enter, allow the default behavior (new line)
        if (event.key === 'Enter' && event.shiftKey) {
            return; // Do nothing, let the browser add a new line.
        }

        // If the user presses only Enter...
        if (event.key === 'Enter') {
            // ...prevent the default behavior (which is to add a new line).
            event.preventDefault();

            // If the share button is not already disabled (e.g., from a cooldown),
            // programmatically click it to submit the post.
            if (!shareButton.disabled) {
                shareButton.click();
            }
        }
    });
});