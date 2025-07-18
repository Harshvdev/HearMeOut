import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
import { getFirestore, collection, serverTimestamp, query, orderBy, getDocs, doc, increment, limit, startAfter, writeBatch, setDoc, runTransaction, getDoc, addDoc } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

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
const auth = getAuth(app);

// Constants & State
const MAX_CHARS = 1200;
const POST_COOLDOWN_SECONDS = 300;
const FEEDBACK_COOLDOWN_SECONDS = 180; // NEW: Cooldown for feedback (3 minutes)
const POSTS_PER_PAGE = 15;
const HIDE_THRESHOLD = 5;

const COLLECTIONS = {
    POSTS_PRIVATE: 'posts',
    POSTS_PUBLIC: 'posts_public',
    USER_ACTIVITY: 'user_activity',
    BUG_REPORTS: 'bug-reports',
    FEATURE_SUGGESTIONS: 'feature-suggestions'
};
const STORAGE_KEYS = {
    THEME: 'theme',
    LAST_POST_TIMESTAMP: 'lastPostTimestamp',
    REPORTED_POSTS: 'reportedPosts',
    MY_POST_IDS: 'myPostIds',
    LAST_BUG_TIMESTAMP: 'lastBugReportTimestamp', // NEW
    LAST_FEATURE_TIMESTAMP: 'lastFeatureSuggestionTimestamp' // NEW
};

let lastVisiblePost = null;
let isLoadingPosts = false;
let allPostsLoaded = false;
let myPostsFilterActive = false;
let currentUserId = null; 

// HTML Element References
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
const postCardTemplate = document.getElementById('post-card-template');
const feedLoader = document.getElementById('feed-loader');
const endOfFeedMessage = document.getElementById('end-of-feed');
const toggleMyPostsButton = document.getElementById('toggle-my-posts-button');
const noPostsFoundMessage = document.getElementById('no-posts-found');
// NEW: Feedback form elements
const submitFeedbackButton = document.getElementById('submit-feedback-button');
const feedbackFormStatus = document.getElementById('feedback-form-status');
const feedbackText = document.getElementById('feedback-text');


// --- SECURE AUTHENTICATION ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUserId = user.uid;
        shareButton.disabled = false;
        postFeed.style.pointerEvents = 'auto';
    } else {
        signInAnonymously(auth).catch((error) => {
            console.error("Anonymous sign-in failed:", error);
            showFeedback('Could not connect to service. Please refresh.', 'error', 0);
        });
    }
});

async function handlePostSubmission(event) {
    event.preventDefault();
    if (!currentUserId) {
        showFeedback("Cannot post: not connected.", "error");
        return;
    }

    const lastPostTime = localStorage.getItem(STORAGE_KEYS.LAST_POST_TIMESTAMP);
    if (lastPostTime && (Date.now() - parseInt(lastPostTime)) / 1000 < POST_COOLDOWN_SECONDS) {
        const secondsRemaining = Math.ceil(POST_COOLDOWN_SECONDS - (Date.now() - parseInt(lastPostTime)) / 1000);
        showFeedback(`Please wait ${secondsRemaining}s to post again.`, 'error');
        return;
    }
    const contentToSubmit = postContent.value.trim();
    if (contentToSubmit === '') {
        showFeedback("You can't share an empty thought!", 'error');
        return;
    }

    const originalText = postContent.value;
    postContent.value = '';
    charCounter.textContent = `0 / ${MAX_CHARS}`;
    shareButton.disabled = true;
    shareButton.textContent = "Sharing...";

    try {
        const batch = writeBatch(db);
        const newPrivatePostRef = doc(collection(db, COLLECTIONS.POSTS_PRIVATE));
        const newPublicPostRef = doc(collection(db, COLLECTIONS.POSTS_PUBLIC), newPrivatePostRef.id);
        
        const privatePostData = { content: contentToSubmit, timestamp: serverTimestamp(), reportCount: 0, authorId: currentUserId, isImmune: false };
        const publicPostData = { content: contentToSubmit, timestamp: serverTimestamp(), reportCount: 0, isImmune: false };
        
        batch.set(newPrivatePostRef, privatePostData);
        batch.set(newPublicPostRef, publicPostData);

        const userActivityRef = doc(db, COLLECTIONS.USER_ACTIVITY, currentUserId);
        batch.set(userActivityRef, { lastPostTimestamp: serverTimestamp(), authorId: currentUserId });

        await batch.commit();

        const myPostIds = JSON.parse(localStorage.getItem(STORAGE_KEYS.MY_POST_IDS)) || [];
        myPostIds.push(newPrivatePostRef.id);
        localStorage.setItem(STORAGE_KEYS.MY_POST_IDS, JSON.stringify(myPostIds));
        localStorage.setItem(STORAGE_KEYS.LAST_POST_TIMESTAMP, Date.now().toString());
        showFeedback('Your post was shared!', 'success');

        const clientSideData = { ...publicPostData, timestamp: { toDate: () => new Date() } };
        const newCard = createPostCard({ id: newPrivatePostRef.id, data: clientSideData });
        postFeed.prepend(newCard);

    } catch (error) {
        console.error("Error adding post: ", error);
        showFeedback("Error sharing post. You may be blocked or posting too frequently.", 'error');
        postContent.value = originalText;
    } finally {
        shareButton.disabled = false;
        shareButton.textContent = "Share Anonymously";
    }
}

// --- MODIFIED: Feedback Submission Handler with Server-Side Cooldown ---
async function handleFeedbackSubmission(event) {
    event.preventDefault();
    if (!currentUserId) {
        showModalFeedback("Cannot submit: not connected.", "error");
        return;
    }

    const formData = new FormData(feedbackForm);
    const type = formData.get('feedbackType');
    const message = feedbackText.value.trim();

    if (message.length < 10) {
        showModalFeedback("Please provide more detail in your feedback.", "error");
        return;
    }

    // Cooldown logic (this client-side check is still good for instant UI feedback)
    const cooldownKey = type === 'bug' ? STORAGE_KEYS.LAST_BUG_TIMESTAMP : STORAGE_KEYS.LAST_FEATURE_TIMESTAMP;
    const lastSubmitTime = localStorage.getItem(cooldownKey);
    if (lastSubmitTime && (Date.now() - parseInt(lastSubmitTime)) / 1000 < FEEDBACK_COOLDOWN_SECONDS) {
        const secondsRemaining = Math.ceil(FEEDBACK_COOLDOWN_SECONDS - (Date.now() - parseInt(lastSubmitTime)) / 1000);
        showModalFeedback(`Please wait ${secondsRemaining}s to submit this type of feedback again.`, 'error');
        return;
    }
    
    submitFeedbackButton.disabled = true;
    submitFeedbackButton.textContent = 'Submitting...';
    showModalFeedback('', 'none');

    try {
        // Use a write batch to update two collections atomically
        const batch = writeBatch(db);
        
        // 1. Prepare the new feedback document
        const collectionName = type === 'bug' ? COLLECTIONS.BUG_REPORTS : COLLECTIONS.FEATURE_SUGGESTIONS;
        const newFeedbackRef = doc(collection(db, collectionName)); // Create a ref with a new auto-ID
        const feedbackData = {
            message: message,
            timestamp: serverTimestamp(),
            userAgent: navigator.userAgent,
            authorId: currentUserId
        };
        batch.set(newFeedbackRef, feedbackData);

        // 2. Prepare the user activity update for the cooldown
        const userActivityRef = doc(db, COLLECTIONS.USER_ACTIVITY, currentUserId);
        const timestampField = type === 'bug' ? 'lastBugReportTimestamp' : 'lastFeatureSuggestionTimestamp';
        
        // CRITICAL: Use { merge: true } to avoid overwriting other fields in the document
        batch.set(userActivityRef, { [timestampField]: serverTimestamp() }, { merge: true });

        // 3. Commit the batch
        await batch.commit();

        // On success, update client-side state
        localStorage.setItem(cooldownKey, Date.now().toString());
        showModalFeedback('Thank you! Your feedback has been submitted.', 'success');
        
        setTimeout(() => {
            feedbackForm.reset();
            closeModal();
            showModalFeedback('', 'none');
        }, 2000);

    } catch (error) {
        console.error('Error submitting feedback:', error);
        // This will now catch security rule violations (e.g., cooldown not met)
        showModalFeedback('Could not submit feedback. Please try again later or ensure you wait long enough between submissions.', 'error');
    } finally {
        submitFeedbackButton.disabled = false;
        submitFeedbackButton.textContent = 'Submit';
    }
}


async function fetchPosts() {
    if (isLoadingPosts || allPostsLoaded) return;
    isLoadingPosts = true;
    feedLoader.style.display = 'block';
    noPostsFoundMessage.style.display = 'none';

    try {
        let q;
        const postsRef = collection(db, COLLECTIONS.POSTS_PUBLIC);
        
        if (lastVisiblePost) {
            q = query(postsRef, orderBy('timestamp', 'desc'), startAfter(lastVisiblePost), limit(POSTS_PER_PAGE));
        } else {
            postFeed.innerHTML = '';
            q = query(postsRef, orderBy('timestamp', 'desc'), limit(POSTS_PER_PAGE));
        }
        const documentSnapshots = await getDocs(q);

        if (documentSnapshots.empty) {
            allPostsLoaded = true;
            endOfFeedMessage.style.display = 'block';
            if (postFeed.childElementCount === 0) {
                postFeed.innerHTML = `<p class="feed-status">No thoughts shared yet. Be the first!</p>`;
            }
        } else {
            documentSnapshots.forEach(docSnap => {
                const postData = docSnap.data();
                const isVisible = postData.reportCount < HIDE_THRESHOLD || postData.isImmune === true;
                if (isVisible) {
                    const card = createPostCard({ id: docSnap.id, data: postData });
                    postFeed.appendChild(card);
                }
            });
            lastVisiblePost = documentSnapshots.docs[documentSnapshots.docs.length - 1];
        }
    } catch (error) {
        console.error("Error fetching posts:", error);
        postFeed.innerHTML = `<p class="feed-status">Could not fetch posts.</p>`;
    } finally {
        isLoadingPosts = false;
        feedLoader.style.display = 'none';
    }
}

function createPostCard(post) {
    const { id, data } = post;
    const reportedPosts = JSON.parse(localStorage.getItem(STORAGE_KEYS.REPORTED_POSTS)) || [];
    const myPostIds = JSON.parse(localStorage.getItem(STORAGE_KEYS.MY_POST_IDS)) || [];
    const card = postCardTemplate.content.cloneNode(true).firstElementChild;
    card.dataset.id = id;
    card.dataset.reportCount = data.reportCount;
    const contentP = card.querySelector('.post-content');
    const timestampSpan = card.querySelector('.post-timestamp');
    const reportButton = card.querySelector('.report-button');
    contentP.textContent = data.content;
    timestampSpan.textContent = formatTimestamp(data.timestamp);
    reportButton.dataset.id = id;
    if (reportedPosts.includes(id)) {
        reportButton.disabled = true;
        reportButton.textContent = 'Reported';
    }
    if (myPostIds.includes(id)) {
        card.classList.add('my-post');
    }
    return card;
}

async function handleReportClick(e) {
    if (!e.target.classList.contains('report-button')) return;
    const btn = e.target;
    const postId = btn.dataset.id;

    if (btn.disabled || !currentUserId) return;
    btn.disabled = true;

    try {
        let newCount;
        await runTransaction(db, async (transaction) => {
            const postRef = doc(db, COLLECTIONS.POSTS_PUBLIC, postId);
            const reportReceiptRef = doc(db, COLLECTIONS.POSTS_PUBLIC, postId, 'reporters', currentUserId);

            const receiptDoc = await transaction.get(reportReceiptRef);
            if (receiptDoc.exists()) { throw new Error("Already reported"); }
            
            const postDoc = await transaction.get(postRef);
            if (!postDoc.exists()) { throw new Error("Post does not exist."); }

            newCount = (postDoc.data().reportCount || 0) + 1;

            transaction.set(reportReceiptRef, { reporterId: currentUserId, timestamp: serverTimestamp() });
            transaction.update(postRef, { reportCount: newCount });
        });

        btn.textContent = 'Reported';
        const reportedPosts = JSON.parse(localStorage.getItem(STORAGE_KEYS.REPORTED_POSTS)) || [];
        if (!reportedPosts.includes(postId)) {
            reportedPosts.push(postId);
            localStorage.setItem(STORAGE_KEYS.REPORTED_POSTS, JSON.stringify(reportedPosts));
        }
        
        const card = btn.closest('.post-card');
        if (card) {
             card.dataset.reportCount = newCount;
             if (newCount >= HIDE_THRESHOLD) {
                 card.style.display = 'none';
             }
        }

    } catch (error) {
        console.error("Report transaction failed: ", error.message);
        if (error.message === "Already reported") {
            btn.textContent = 'Reported';
        } else {
            btn.disabled = false;
        }
    }
}

// Helper functions
function applyTheme(theme) { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem(STORAGE_KEYS.THEME, theme); themeToggleButton.textContent = theme === 'dark' ? '☀️' : '🌙'; }
function initializeTheme() { const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); applyTheme(savedTheme); }
function openModal() { feedbackModalOverlay.classList.add('open'); }
function closeModal() { feedbackModalOverlay.classList.remove('open'); }
function formatTimestamp(timestamp) { if (!timestamp) return ''; const postDate = timestamp.toDate(); const now = new Date(); const secondsAgo = Math.round((now - postDate) / 1000); if (secondsAgo < 60) return `${secondsAgo}s ago`; if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`; if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}h ago`; return `${Math.floor(secondsAgo / 86400)}d ago`; }
function showFeedback(message, type = 'error', duration = 4000) { feedbackMessage.textContent = message; feedbackMessage.className = `feedback-message ${type}`; if (duration > 0) { setTimeout(() => { feedbackMessage.textContent = ''; feedbackMessage.className = 'feedback-message'; }, duration); } }
function showModalFeedback(message, type = 'none') { feedbackFormStatus.textContent = message; feedbackFormStatus.className = `feedback-form-status ${type}`; }
function handleMyPostsToggle() { myPostsFilterActive = !myPostsFilterActive; document.body.classList.toggle('my-posts-view', myPostsFilterActive); toggleMyPostsButton.classList.toggle('active', myPostsFilterActive); if (myPostsFilterActive) { toggleMyPostsButton.textContent = 'All Posts'; const myPosts = postFeed.querySelectorAll('.my-post'); noPostsFoundMessage.style.display = myPosts.length === 0 ? 'block' : 'none'; feedLoader.style.display = 'none'; endOfFeedMessage.style.display = 'none'; } else { toggleMyPostsButton.textContent = 'My Posts'; noPostsFoundMessage.style.display = 'none'; if (allPostsLoaded && postFeed.childElementCount > 0) { endOfFeedMessage.style.display = 'block'; } } }
function handleScroll() { if (myPostsFilterActive) return; const { scrollTop, scrollHeight, clientHeight } = document.documentElement; if (scrollTop + clientHeight >= scrollHeight - 250) { fetchPosts(); } }

document.addEventListener('DOMContentLoaded', () => { 
    initializeTheme(); 
    fetchPosts(); 
    document.getElementById('post-form').addEventListener('submit', handlePostSubmission); 
    postFeed.addEventListener('click', handleReportClick); 
    themeToggleButton.addEventListener('click', () => applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light')); 
    openFeedbackLink.addEventListener('click', (e) => { e.preventDefault(); openModal(); }); 
    closeModalButton.addEventListener('click', closeModal); 
    feedbackModalOverlay.addEventListener('click', (e) => { if (e.target === feedbackModalOverlay) closeModal(); }); 
    feedbackForm.addEventListener('submit', handleFeedbackSubmission);
    toggleMyPostsButton.addEventListener('click', handleMyPostsToggle); 
    postContent.addEventListener('input', () => { charCounter.textContent = `${postContent.value.length} / ${MAX_CHARS}`; }); 
    postContent.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!shareButton.disabled) document.getElementById('post-form').requestSubmit(); } }); 
    window.addEventListener('scroll', handleScroll); 
});