// =====================================================================
// 1. IMPORTS - All necessary functions from the Firebase SDK
// =====================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { 
    getFirestore, 
    collection, 
    addDoc, 
    serverTimestamp,
    query,
    orderBy,
    onSnapshot,
    doc,
    updateDoc,
    increment
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
// 3. HTML ELEMENT REFERENCES & IN-MEMORY STATE
// =====================================================================
const postContent = document.getElementById('post-content');
const shareButton = document.getElementById('share-button');
const postFeed = document.getElementById('post-feed');

// This Set holds the IDs of posts currently being reported.
// It prevents multiple clicks while a request is processing.
const reportingInProgress = new Set();


// =====================================================================
// 4. FUNCTION DEFINITIONS - All functions are defined here first
// =====================================================================

// --- LOCAL STORAGE HELPER FUNCTIONS ---
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

// --- MAIN APPLICATION FUNCTIONS ---
async function handlePostSubmission() {
    const content = postContent.value.trim();
    if (content === '') {
        alert("You can't share an empty thought!");
        return;
    }
    shareButton.disabled = true;
    shareButton.textContent = "Sharing...";
    try {
        const newPost = {
            content: content,
            timestamp: serverTimestamp(),
            reportCount: 0
        };
        const postsCollectionRef = collection(db, 'posts');
        await addDoc(postsCollectionRef, newPost);
        postContent.value = '';
    } catch (error) {
        console.error("Error adding document: ", error);
        alert("Sorry, there was an error sharing your post. Please try again.");
    } finally {
        shareButton.disabled = false;
        shareButton.textContent = "Share Anonymously";
    }
}

function listenForPosts() {
    const postsCollectionRef = collection(db, 'posts');
    const q = query(postsCollectionRef, orderBy('timestamp', 'desc'));

    onSnapshot(q, (snapshot) => {
        const reportedPostsLocally = getReportedPostsFromStorage();
        postFeed.innerHTML = '';
        
        snapshot.forEach((doc) => {
            const postData = doc.data();
            const postId = doc.id;

            if (postData.reportCount < 3) {
                const card = document.createElement('div');
                card.classList.add('post-card');
                
                const reportButton = document.createElement('button');
                reportButton.classList.add('report-button');
                reportButton.textContent = 'Report';
                reportButton.dataset.id = postId;

                // --- THE FINAL FIX ---
                // A button should be disabled if EITHER the report is already
                // saved in localStorage OR a report is currently in-flight.
                // This correctly handles the UI re-render during the race condition.
                if (reportedPostsLocally.includes(postId) || reportingInProgress.has(postId)) {
                    reportButton.disabled = true;
                    reportButton.textContent = "Reported";
                }

                const contentP = document.createElement('p');
                contentP.textContent = postData.content;

                card.appendChild(reportButton);
                card.appendChild(contentP);
                postFeed.appendChild(card);
            }
        });
    }, (error) => {
        console.error("Error listening to post updates: ", error);
        postFeed.innerHTML = '<p style="color: red;">Could not fetch posts. Please try again later.</p>';
    });
}


// =====================================================================
// 5. SCRIPT EXECUTION - Event listeners and initial function calls
// =====================================================================
listenForPosts();

shareButton.addEventListener('click', async (event) => {
    event.preventDefault();
    await handlePostSubmission();
});

postFeed.addEventListener('click', async (event) => {
    if (event.target.classList.contains('report-button') && !event.target.disabled) {
        const postId = event.target.dataset.id;
        
        // Immediately check the in-progress lock. This stops rapid-fire clicks.
        if (reportingInProgress.has(postId)) {
            return; 
        }

        // Add the post to the in-progress set to lock it.
        reportingInProgress.add(postId);

        // Visually disable the button immediately. This is an optimistic UI update.
        event.target.disabled = true;
        event.target.textContent = "Reported";

        try {
            const postRef = doc(db, 'posts', postId);
            await updateDoc(postRef, {
                reportCount: increment(1)
            });
            
            // On success, save to persistent storage.
            addPostToReportedStorage(postId);

        } catch (error) {
            console.error("Error reporting post: ", error);
            // On failure, we don't re-enable the button here. The onSnapshot listener
            // will re-render the feed, and since the report failed, the button will
            // be correctly rendered as enabled (as it's not in localStorage).
        } finally {
            // Always remove the post from the in-progress set after the operation.
            reportingInProgress.delete(postId);
        }
    }
});