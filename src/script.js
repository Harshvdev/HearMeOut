// =====================================================================
// 1. IMPORTS & FIREBASE SETUP
// =====================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { 
    getFirestore, collection, addDoc, serverTimestamp,
    query, orderBy, getDocs, doc, updateDoc, increment,
    limit, startAfter 
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
// --- Application Constants
const MAX_WORDS = 200;
const MAX_CHARS = 1200;
const POST_COOLDOWN_SECONDS = 300; // 5 minutes
const POSTS_PER_PAGE = 15; // Number of posts to fetch per batch for infinite scroll

// --- "Magic String" Constants for Collections & Local Storage
const COLLECTIONS = {
    POSTS: 'posts',
    BUG_REPORTS: 'bug-reports',
    FEATURE_SUGGESTIONS: 'feature-suggestions'
};
const STORAGE_KEYS = {
    THEME: 'theme',
    LAST_POST_TIMESTAMP: 'lastPostTimestamp',
    REPORTED_POSTS: 'reportedPosts',
    ANONYMOUS_USER_ID: 'anonymousUserId'
};

// --- State Variables
let lastVisiblePost = null; // Tracks the last post for pagination
let isLoadingPosts = false; // Prevents multiple fetches at once
let allPostsLoaded = false; // Becomes true when the end of the feed is reached
let myPostsFilterActive = false; // Tracks if the "My Posts" filter is on

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
const postCardTemplate = document.getElementById('post-card-template');
const feedLoader = document.getElementById('feed-loader');
const endOfFeedMessage = document.getElementById('end-of-feed');
const toggleMyPostsButton = document.getElementById('toggle-my-posts-button');
const noPostsFoundMessage = document.getElementById('no-posts-found');

// =====================================================================
// 3. ANONYMOUS IDENTITY, THEME, & MODAL MANAGEMENT
// =====================================================================

function getAnonymousUserId() {
    let userId = localStorage.getItem(STORAGE_KEYS.ANONYMOUS_USER_ID);
    if (!userId) {
        userId = crypto.randomUUID();
        localStorage.setItem(STORAGE_KEYS.ANONYMOUS_USER_ID, userId);
    }
    return userId;
}
const ANONYMOUS_USER_ID = getAnonymousUserId();

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
    themeToggleButton.textContent = theme === 'dark' ? '☀️' : '🌙';
}
function initializeTheme() {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
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
    
    const collectionName = feedbackType === 'bug' ? COLLECTIONS.BUG_REPORTS : COLLECTIONS.FEATURE_SUGGESTIONS;

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

function formatTimestamp(timestamp) {
    if (!timestamp) return '';
    const postDate = timestamp.toDate();
    const now = new Date();
    const secondsAgo = Math.round((now - postDate) / 1000);

    if (secondsAgo < 60) return `${secondsAgo}s ago`;
    if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
    if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}h ago`;
    if (secondsAgo < 604800) return `${Math.floor(secondsAgo / 86400)}d ago`;

    const dateOptions = { year: 'numeric', month: 'long', day: 'numeric' };
    return postDate.toLocaleDateString('en-US', dateOptions);
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
    const lastPostTime = localStorage.getItem(STORAGE_KEYS.LAST_POST_TIMESTAMP);
    if (lastPostTime && (Date.now() - parseInt(lastPostTime)) / 1000 < POST_COOLDOWN_SECONDS) {
        const secondsRemaining = Math.ceil(POST_COOLDOWN_SECONDS - (Date.now() - parseInt(lastPostTime)) / 1000);
        showFeedback(`Please wait ${secondsRemaining}s to post again.`, 'error');
        return;
    }
    const contentToSubmit = postContent.value.trim();
    const wordCount = contentToSubmit.split(/\s+/).filter(Boolean).length;
    if (contentToSubmit === '') { showFeedback("You can't share an empty thought!", 'error'); return; }
    if (wordCount > MAX_WORDS) { showFeedback(`Post exceeds the ${MAX_WORDS}-word limit.`, 'error'); return; }

    const originalText = postContent.value; // Save original text in case of error
    postContent.value = '';
    charCounter.textContent = `0 / ${MAX_CHARS}`;
    shareButton.disabled = true;
    shareButton.textContent = "Sharing...";
    showFeedback("Sharing your thought...", 'success', 0);

    try {
        const newPostData = {
            content: contentToSubmit,
            timestamp: { toDate: () => new Date() }, // Create a client-side timestamp for immediate display
            reportCount: 0,
            authorId: ANONYMOUS_USER_ID
        };

        // [NEW] Optimistic UI: Create and prepend the post card immediately.
        const newCard = createPostCard({ id: 'temp-id', data: newPostData });
        postFeed.prepend(newCard);
        
        // Remove the "no posts yet" or "no posts found" messages if they are showing
        const feedStatusMessage = postFeed.querySelector('.feed-status');
        if (feedStatusMessage) {
            feedStatusMessage.remove();
        }
        noPostsFoundMessage.style.display = 'none';

        await addDoc(collection(db, COLLECTIONS.POSTS), {
            content: contentToSubmit,
            timestamp: serverTimestamp(), // Use the real server timestamp for the database
            reportCount: 0,
            authorId: ANONYMOUS_USER_ID
        });
        localStorage.setItem(STORAGE_KEYS.LAST_POST_TIMESTAMP, Date.now().toString());
        showFeedback('Your post was shared!', 'success');
    } catch (error) {
        console.error("Error adding document: ", error);
        showFeedback("Error sharing post. Your text is restored.", 'error');
        postContent.value = originalText; // Restore original text on error
        charCounter.textContent = `${originalText.length} / ${MAX_CHARS}`;
        
        // [NEW] If the post failed, remove the optimistic card we added.
        const optimisticCard = postFeed.querySelector('[data-id="temp-id"]');
        if (optimisticCard) {
            optimisticCard.remove();
        }

    } finally {
        shareButton.disabled = false;
        shareButton.textContent = "Share Anonymously";
    }
}


function createPostCard(post) {
    const { id, data } = post;
    const reportedPosts = JSON.parse(localStorage.getItem(STORAGE_KEYS.REPORTED_POSTS)) || [];

    const card = postCardTemplate.content.cloneNode(true).firstElementChild;
    card.dataset.id = id;

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

    if (data.authorId === ANONYMOUS_USER_ID) {
        card.classList.add('my-post');
    }

    return card;
}

async function fetchPosts() {
    if (isLoadingPosts || allPostsLoaded) return;

    isLoadingPosts = true;
    feedLoader.style.display = 'block';
    noPostsFoundMessage.style.display = 'none';

    try {
        let q;
        const postsRef = collection(db, COLLECTIONS.POSTS);
        
        if (lastVisiblePost) {
            q = query(postsRef, orderBy('timestamp', 'desc'), startAfter(lastVisiblePost), limit(POSTS_PER_PAGE));
        } else {
            postFeed.innerHTML = ''; // Clear feed only on first load
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
            documentSnapshots.forEach(doc => {
                if (doc.data().reportCount < 3) {
                    const card = createPostCard({ id: doc.id, data: doc.data() });
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

function handleReportClick(e) {
    if (!e.target.classList.contains('report-button')) return;
    const btn = e.target;
    const postId = btn.dataset.id;
    if (btn.disabled) return;
    
    btn.disabled = true;
    btn.textContent = 'Reported';

    const reportedPosts = JSON.parse(localStorage.getItem(STORAGE_KEYS.REPORTED_POSTS)) || [];
    if (!reportedPosts.includes(postId)) {
        reportedPosts.push(postId);
        localStorage.setItem(STORAGE_KEYS.REPORTED_POSTS, JSON.stringify(reportedPosts));
    }
    
    updateDoc(doc(db, COLLECTIONS.POSTS, postId), { reportCount: increment(1) })
        .catch(error => {
            console.error("Error reporting post: ", error);
            btn.disabled = false;
            btn.textContent = 'Report';
            const updatedReportedPosts = reportedPosts.filter(id => id !== postId);
            localStorage.setItem(STORAGE_KEYS.REPORTED_POSTS, JSON.stringify(updatedReportedPosts));
            showFeedback('Could not report post. Please try again.', 'error');
        });
}

function handleMyPostsToggle() {
    myPostsFilterActive = !myPostsFilterActive;
    document.body.classList.toggle('my-posts-view', myPostsFilterActive);
    toggleMyPostsButton.classList.toggle('active', myPostsFilterActive);

    if (myPostsFilterActive) {
        toggleMyPostsButton.textContent = 'All Posts';
        const myPosts = postFeed.querySelectorAll('.my-post');
        if (myPosts.length === 0) {
            noPostsFoundMessage.style.display = 'block';
        }
        feedLoader.style.display = 'none';
        endOfFeedMessage.style.display = 'none';
    } else {
        toggleMyPostsButton.textContent = 'My Posts';
        noPostsFoundMessage.style.display = 'none';
        if (allPostsLoaded && postFeed.childElementCount > 0) {
            endOfFeedMessage.style.display = 'block';
        }
    }
}

function handleScroll() {
    if (myPostsFilterActive) return;

    const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
    if (scrollTop + clientHeight >= scrollHeight - 250) {
        fetchPosts();
    }
}

// =====================================================================
// 5. INITIALIZATION & EVENT LISTENERS
// =====================================================================
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

    window.addEventListener('scroll', handleScroll);
});