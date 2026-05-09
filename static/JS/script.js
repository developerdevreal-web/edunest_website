function showFlash(message, type = "info") {
    const container = document.getElementById("flash-messages");
    const flashDiv = document.createElement("div");
    flashDiv.className = `flash-message flash-${type}`;
    flashDiv.innerHTML = `<span>${message}</span><button onclick="this.parentElement.remove()" style="background:none;border:none;color:white;margin-left:12px;cursor:pointer;">&times;</button>`;
    flashDiv.style.backgroundColor = type === "error" ? "#dc2626" : type === "success" ? "#10b981" : "#3b82f6";
    flashDiv.style.color = "white";
    flashDiv.style.padding = "12px 16px";
    flashDiv.style.borderRadius = "8px";
    flashDiv.style.marginBottom = "8px";
    flashDiv.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
    flashDiv.style.display = "flex";
    flashDiv.style.justifyContent = "space-between";
    flashDiv.style.alignItems = "center";
    container.appendChild(flashDiv);
    setTimeout(() => flashDiv.remove(), 5000);
}

function openMobileSidebar() {
    document.getElementById("mobileSidebar").classList.add("open");
    document.getElementById("sidebarOverlay").classList.add("active");
    document.body.style.overflow = "hidden";
}
function closeMobileSidebar() {
    document.getElementById("mobileSidebar").classList.remove("open");
    document.getElementById("sidebarOverlay").classList.remove("active");
    document.body.style.overflow = "";
}

const firebaseConfig = {
    apiKey: "AIzaSyCSsNji4eBUJJJwGgfGt5K8-T1WOmdSolI",
    authDomain: "edunest-21f58.firebaseapp.com",
    projectId: "edunest-21f58",
    storageBucket: "edunest-21f58.firebasestorage.app",
    messagingSenderId: "76156747794",
    appId: "1:76156747794:web:00b28d97db3dfdca6458cb",
    measurementId: "G-MMM9J2DSNJ"
};
let firebaseApp = null;
let googleProvider = null;
try {
    firebaseApp = firebase.initializeApp(firebaseConfig);
    googleProvider = new firebase.auth.GoogleAuthProvider();
} catch (e) {}

let currentUser = null;
let isTeacherMode = false;
let allTests = [];
let activeTest = null;
let isTestActive = false;
let reactivationTimerInterval = null;
let isViewingStudent = false;
let originalUserForTeacher = null;
let violationTriggered = false;
let proctoringEventsAttached = false;
let isPracticeMode = false;
let pendingTestId = null;
let currentTestReactivations = 0;
let currentViewingStudentId = null;
let viewingStudentProfile = null;
let userAttemptedTests = new Set();
let currentSessionId = null;
let currentViolationId = null;
let proctoringPollInterval = null;
const teacherAnswersVisible = {};

function getAnswerKeyCount() {
    return Math.min(120, Math.max(1, parseInt(document.getElementById("totalQuestions")?.value, 10) || 40));
}

function renderAnswerKeyBuilder() {
    const wrap = document.getElementById("answerKeyBuilder");
    if (!wrap) return;
    const n = getAnswerKeyCount();
    wrap.innerHTML = "";
    for (let i = 0; i < n; i++) {
        const row = document.createElement("div");
        row.className = "ak-row";
        row.dataset.q = String(i);
        row.style.cssText = "display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;flex-wrap:wrap;";
        row.innerHTML = `<span style="min-width:42px;font-weight:600;">Q${i + 1}</span>
            <div class="ak-inputs" style="display:flex;flex-wrap:wrap;gap:8px;flex:1;"></div>
            <button type="button" class="btn-outline" style="padding:6px 12px;" data-add="${i}">+</button>`;
        wrap.appendChild(row);
        addAnswerSlot(i);
        row.querySelector(`[data-add="${i}"]`).addEventListener("click", () => addAnswerSlot(i));
    }
}

function addAnswerSlot(questionIndex) {
    const inputs = document.querySelector(`.ak-row[data-q="${questionIndex}"] .ak-inputs`);
    if (!inputs) return;
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "ak-ans";
    inp.placeholder = "Answer";
    inp.style.cssText = "min-width:120px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid var(--glass-border);color:#fff;";
    inputs.appendChild(inp);
}

function collectAnswerKeyFromForm() {
    const n = getAnswerKeyCount();
    const key = [];
    for (let i = 0; i < n; i++) {
        const inputs = document.querySelectorAll(`.ak-row[data-q="${i}"] .ak-ans`);
        const vals = [...inputs].map((el) => el.value.trim()).filter(Boolean);
        key.push(vals);
    }
    return key;
}

function syncAnswerKeySectionVisibility() {
    const type = document.getElementById("testType")?.value;
    const wrap = document.getElementById("answerKeyBuilderWrap");
    if (!wrap) return;
    if (type === "reading" || type === "listening") {
        wrap.style.display = "block";
        renderAnswerKeyBuilder();
    } else {
        wrap.style.display = "none";
    }
}

async function apiCall(url, method = "GET", body = null) {
    const options = { method, headers: { "Content-Type": "application/json" }, credentials: "same-origin" };
    if (body) options.body = JSON.stringify(body);
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
}

async function loadData() {
    try {
        const data = await apiCall("/api/auth/me");
        currentUser = data.user;
        if (currentUser) {
            await fetchTests();
            await loadUserAttempts();
            updateUIForUser();
            const target = window.INITIAL_PAGE || "dashboard";
            if (target === "login") showAuth("login");
            else if (target === "register") showAuth("register");
            else if (["dashboard", "tests", "students", "addTest"].includes(target)) showPage(target);
            else showPage("dashboard");
        } else {
            const target = window.INITIAL_PAGE || "home";
            if (target === "login") showAuth("login");
            else if (target === "register") showAuth("register");
            else showPage("home");
        }
    } catch (err) {
        showPage("home");
    }
}

async function fetchTests() {
    try {
        allTests = await apiCall("/api/tests");
    } catch (e) {
        showFlash("Failed to load tests", "error");
    }
}

async function loadUserAttempts() {
    if (!currentUser || (currentUser.role === "teacher" && !isViewingStudent)) return;
    try {
        const attempts = await apiCall("/api/attempts/user");
        userAttemptedTests.clear();
        attempts.forEach((a) => userAttemptedTests.add(a.testId));
    } catch (e) {}
}

function updateUIForUser() {
    if (!currentUser) {
        document.getElementById("authButtons").style.display = "flex";
        document.getElementById("profileContainer").style.display = "none";
        return;
    }
    document.getElementById("authButtons").style.display = "none";
    document.getElementById("profileContainer").style.display = "block";
    document.getElementById("profileCircle").innerText = currentUser.name.charAt(0).toUpperCase();
    const isTeacher = currentUser.role === "teacher";
    document.getElementById("studentsNav").style.display = isTeacher ? "block" : "none";
    document.getElementById("addTestNav").style.display = isTeacher ? "block" : "none";
    document.getElementById("testsNav").style.display = "block";
    document.getElementById("dashboardNav").style.display = "block";
    document.getElementById("mobileStudentsNav").style.display = isTeacher ? "block" : "none";
    document.getElementById("mobileAddTestNav").style.display = isTeacher ? "block" : "none";
    document.getElementById("mobileTestsNav").style.display = "block";
    document.getElementById("mobileDashboardNav").style.display = "block";
    updateDashboard();
}

async function handleAuth() {
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value.trim();
    const isRegister = window.authMode === "register";
    const name = document.getElementById("authName").value.trim();
    if (!email || !password) return showFlash("Fill all fields", "error");
    if (isRegister && !name) return showFlash("Enter your name", "error");
    const endpoint = isRegister ? "/api/auth/register" : "/api/auth/login";
    const body = isRegister ? { name, email, password } : { email, password };
    try {
        currentUser = await apiCall(endpoint, "POST", body);
        await fetchTests();
        await loadUserAttempts();
        updateUIForUser();
        showPage("dashboard");
        showFlash(isRegister ? "Registration successful!" : "Logged in", "success");
    } catch (err) {
        showFlash(err.message, "error");
    }
}

async function logout() {
    try { await apiCall("/api/auth/logout", "POST"); } catch (e) {}
    currentUser = null;
    isViewingStudent = false;
    document.getElementById("authButtons").style.display = "flex";
    document.getElementById("profileContainer").style.display = "none";
    showPage("home");
    closeMobileSidebar();
}

async function signInWithGoogle() {
    if (!firebaseApp) return showFlash("Google Sign-In requires Firebase configuration.", "error");
    try {
        const result = await firebase.auth().signInWithPopup(googleProvider);
        const user = result.user;
        currentUser = await apiCall("/api/auth/google", "POST", {
            email: user.email,
            name: user.displayName || user.email.split("@")[0],
            uid: user.uid
        });
        await fetchTests();
        await loadUserAttempts();
        updateUIForUser();
        showPage("dashboard");
    } catch (error) {
        showFlash("Google Sign-In failed: " + error.message, "error");
    }
}

async function updateDashboard() {
    if (!currentUser) return;
    const shownName = isViewingStudent && viewingStudentProfile ? viewingStudentProfile.name : currentUser.name;
    document.getElementById("userName").innerText = shownName;
    document.getElementById("dashboardRole").innerHTML = isViewingStudent
        ? '👨‍🏫 Viewing Student Dashboard <button class="btn-outline" style="margin-left:10px;padding:4px 10px;" onclick="exitStudentView()">Back to Teacher</button>'
        : (currentUser.role === "teacher" ? "👨‍🏫 Teacher" : "🎓 Student");
    try {
        const targetStudentId = isViewingStudent && currentViewingStudentId ? currentViewingStudentId : null;
        const attempts = await apiCall(`/api/attempts/user${targetStudentId ? "/" + targetStudentId : ""}`);
        const testsCount = attempts.length;
        const totalScore = attempts.reduce((sum, a) => sum + a.score, 0);
        const totalBand = attempts.reduce((sum, a) => sum + a.bandScore, 0);
        const avgBand = testsCount ? (totalBand / testsCount).toFixed(1) : 0;
        const totalReactivations = attempts.reduce((sum, a) => sum + (a.reactivationsUsed || 0), 0);
        document.getElementById("testsTaken").innerText = testsCount;
        document.getElementById("avgBand").innerText = avgBand;
        document.getElementById("totalCorrect").innerText = totalScore;
        document.getElementById("totalReactivations").innerText = totalReactivations;
        document.getElementById("testHistoryList").innerHTML = attempts.length
            ? attempts.slice().reverse().map((t) => {
                const right = t.writingPending ? '<span style="color:#f59e0b;">Writing — pending teacher grade</span>' : `<span style="color: var(--primary-red);">Band ${t.bandScore} (${t.score}/${t.total})</span>`;
                return `<div class="task-row" style="padding: 12px 0; border-bottom: 1px solid var(--glass-border);"><span>${t.testTitle}</span><span>${right}</span></div>`;
            }).join("")
            : '<div class="empty-state">No tests taken yet</div>';
    } catch (e) {
        showFlash("Error loading attempts", "error");
    }
}

function displayAvailableTests() {
    const container = document.getElementById("availableTestsList");
    const currentFilter = document.querySelector(".filter-chip.active")?.dataset.filter || "all";
    const filteredTests = currentFilter === "all" ? allTests : allTests.filter((t) => t.type === currentFilter);
    if (!filteredTests.length) {
        container.innerHTML = '<div class="empty-state">No tests available</div>';
        return;
    }
    container.innerHTML = filteredTests.map((test) => `
        <div class="test-card ${test.type} ${test.isPremium ? "premium" : ""}" onclick="handleTestClick(${test.id}, ${userAttemptedTests.has(test.id)})">
            <div class="test-card-header">
                <span class="test-badge ${test.isPremium ? "badge-premium" : "badge-free"}">${test.isPremium ? "Premium" : "Free"}</span>
                <span class="test-badge badge-${test.type}">${test.type}</span>
            </div>
            <div style="padding: 0 20px 20px 20px;">
                <h3 class="test-title">${test.title}</h3>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px; flex-wrap: wrap; gap: 8px;">
                    <span>${test.totalQuestions} questions</span>
                    <span style="display:flex;gap:8px;">
                        ${userAttemptedTests.has(test.id) ? `<button class="take-test-btn" style="background:#374151;" onclick="event.stopPropagation(); openTestResults(${test.id})">Results</button>` : ""}
                        <button class="take-test-btn" onclick="event.stopPropagation(); handleTestClick(${test.id}, ${userAttemptedTests.has(test.id)})">${userAttemptedTests.has(test.id) ? "Practice Again" : "Start Test"}</button>
                    </span>
                </div>
            </div>
        </div>
    `).join("");
}

function handleTestClick(testId, isTaken) {
    if (isTaken) {
        pendingTestId = testId;
        document.getElementById("practiceModal").classList.add("active");
    } else {
        isPracticeMode = false;
        currentTestReactivations = 0;
        takeTestFullscreen(testId);
    }
}

function closePracticeModal() {
    document.getElementById("practiceModal").classList.remove("active");
    pendingTestId = null;
}

function startPracticeMode() {
    document.getElementById("practiceModal").classList.remove("active");
    if (pendingTestId) {
        isPracticeMode = true;
        currentTestReactivations = 0;
        takeTestFullscreen(pendingTestId);
        pendingTestId = null;
    }
}

function setupFilters() {
    document.querySelectorAll(".filter-chip").forEach((btn) => {
        btn.addEventListener("click", function () {
            if (!this.dataset.filter) return;
            document.querySelectorAll(".filter-chip[data-filter]").forEach((b) => b.classList.remove("active"));
            this.classList.add("active");
            displayAvailableTests();
        });
    });
}

async function takeTestFullscreen(testId) {
    const test = allTests.find((t) => t.id === testId);
    if (!test) return;
    if (!isPracticeMode && userAttemptedTests.has(test.id)) {
        showFlash("Already taken!", "error");
        return;
    }
    if (test.isPremium && !currentUser?.premium) {
        showFlash("Premium test. Upgrade!", "error");
        return;
    }
    if (test.needsPassword && test.testPassword) {
        const pwd = prompt("Password:");
        if (pwd !== test.testPassword) {
            showFlash("Wrong password!", "error");
            return;
        }
    }

    activeTest = test;
    isTestActive = true;
    violationTriggered = false;
    currentTestReactivations = 0;
    document.getElementById("fullscreenTestTitle").innerText = test.title + (isPracticeMode ? " (PRACTICE MODE)" : "");
    let extraSheet = "";
    const nq = test.totalQuestions || 40;
    if (test.type === "reading" || test.type === "listening") {
        let rows = "";
        for (let i = 0; i < nq; i++) {
            rows += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><label style="min-width:48px;">Q${i + 1}</label><input type="text" id="studentAnswer-${i}" autocomplete="off" style="flex:1;padding:10px;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid var(--glass-border);color:#fff;"></div>`;
        }
        extraSheet = `<div class="student-answer-sheet" style="margin-top:24px;padding:20px;background:rgba(0,0,0,0.2);border-radius:12px;"><h3 style="margin-bottom:16px;">Your answers (${nq} questions)</h3>${rows}</div>`;
    } else if (test.type === "writing") {
        extraSheet = `<div style="margin-top:24px;padding:20px;background:rgba(0,0,0,0.2);border-radius:12px;">
            <h3 style="margin-bottom:12px;">Your writing</h3>
            <label style="display:block;margin-bottom:8px;font-weight:600;">Section / Task 1</label>
            <textarea id="writingSection1" rows="8" style="width:100%;padding:12px;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid var(--glass-border);color:#fff;margin-bottom:16px;"></textarea>
            <label style="display:block;margin-bottom:8px;font-weight:600;">Section / Task 2</label>
            <textarea id="writingSection2" rows="8" style="width:100%;padding:12px;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid var(--glass-border);color:#fff;"></textarea>
        </div>`;
    }
    document.getElementById("fullscreenTestContent").innerHTML = `<div id="activeTestContainer">${test.htmlCode}${extraSheet}<div style="text-align:center;padding:30px;"><button class="btn-primary" onclick="submitFullscreenTest()">${isPracticeMode ? "Finish Practice" : "Submit Test"}</button></div></div>`;
    const fullscreenDiv = document.getElementById("fullscreenTest");
    fullscreenDiv.classList.add("active");
    if (fullscreenDiv.requestFullscreen) fullscreenDiv.requestFullscreen();

    if (proctoringEventsAttached) removeProctoringListeners();
    if (test.hasReactivation && !isPracticeMode) {
        try {
            const res = await apiCall("/api/session/start", "POST", { testId: test.id });
            currentSessionId = res.sessionId;
        } catch (e) {
            showFlash("Failed to start session", "error");
            exitFullscreenTest();
            return;
        }
    }
    attachProctoringListeners();
}

function attachProctoringListeners() {
    const reportViolation = async () => {
        if (!isTestActive || !activeTest || !activeTest.hasReactivation || isPracticeMode || violationTriggered) return;
        violationTriggered = true;
        try {
            const res = await apiCall("/api/session/violation", "POST", { sessionId: currentSessionId });
            currentViolationId = res.violationId;
            showReactivationPopup(res.code);
        } catch (e) {
            showFlash("Error reporting violation", "error");
            violationTriggered = false;
        }
    };

    const visibilityOrBlurHandler = async () => {
        if (document.visibilityState === "hidden" || document.hasFocus() === false) {
            await reportViolation();
        } else {
            await checkPendingViolation();
        }
    };

    const fullscreenExitHandler = async () => {
        if (isTestActive && activeTest?.hasReactivation && !document.fullscreenElement) {
            await reportViolation();
        }
    };

    const pageHideHandler = async () => {
        await reportViolation();
    };

    window.testViolationHandler = visibilityOrBlurHandler;
    window.testFullscreenExitHandler = fullscreenExitHandler;
    window.testPageHideHandler = pageHideHandler;
    window.testFocusHandler = checkPendingViolation;

    document.addEventListener("visibilitychange", visibilityOrBlurHandler);
    window.addEventListener("blur", visibilityOrBlurHandler);
    window.addEventListener("focus", window.testFocusHandler);
    document.addEventListener("fullscreenchange", fullscreenExitHandler);
    window.addEventListener("pagehide", pageHideHandler);
    proctoringPollInterval = setInterval(checkPendingViolation, 2500);
    proctoringEventsAttached = true;
}

function removeProctoringListeners() {
    if (window.testViolationHandler) {
        document.removeEventListener("visibilitychange", window.testViolationHandler);
        window.removeEventListener("blur", window.testViolationHandler);
    }
    if (window.testFullscreenExitHandler) {
        document.removeEventListener("fullscreenchange", window.testFullscreenExitHandler);
    }
    if (window.testPageHideHandler) {
        window.removeEventListener("pagehide", window.testPageHideHandler);
    }
    if (window.testFocusHandler) {
        window.removeEventListener("focus", window.testFocusHandler);
    }
    if (proctoringPollInterval) {
        clearInterval(proctoringPollInterval);
        proctoringPollInterval = null;
    }
    proctoringEventsAttached = false;
}

function showReactivationPopup(code, initialSeconds = 60) {
    const popup = document.getElementById("reactivationPopup");
    let seconds = Math.max(0, Number(initialSeconds || 60));
    document.getElementById("reactivationTimer").innerText = seconds;
    popup.classList.add("active");
    popup.dataset.expectedCode = code;
    if (reactivationTimerInterval) clearInterval(reactivationTimerInterval);
    reactivationTimerInterval = setInterval(() => {
        seconds -= 1;
        document.getElementById("reactivationTimer").innerText = seconds;
        if (seconds <= 0) {
            clearInterval(reactivationTimerInterval);
            popup.classList.remove("active");
            showFlash("Time expired. Submitting test.", "error");
            submitFullscreenTest();
        }
    }, 1000);
}

async function checkPendingViolation() {
    if (!isTestActive || !activeTest || !activeTest.hasReactivation || isPracticeMode) return;
    try {
        const res = await apiCall("/api/session/pending");
        const pending = res?.pending;
        if (!pending) return;
        const popup = document.getElementById("reactivationPopup");
        if (popup.classList.contains("active") && currentViolationId === pending.violationId) return;
        currentViolationId = pending.violationId;
        violationTriggered = true;
        showReactivationPopup(pending.code, pending.remainingSeconds);
    } catch (e) {}
}

async function submitFullscreenTest() {
    isTestActive = false;
    clearInterval(reactivationTimerInterval);
    document.getElementById("reactivationPopup").classList.remove("active");
    removeProctoringListeners();
    const container = document.getElementById("activeTestContainer");
    if (!container || !activeTest) return exitFullscreenTest();
    if (isPracticeMode) {
        showFlash("Practice mode done! Score not saved.", "info");
        isPracticeMode = false;
        return exitFullscreenTest();
    }
    const nq = activeTest.totalQuestions || 40;
    try {
        if (activeTest.type === "reading" || activeTest.type === "listening") {
            const studentAnswers = [];
            for (let i = 0; i < nq; i++) {
                const el = document.getElementById(`studentAnswer-${i}`);
                studentAnswers.push(el ? el.value : "");
            }
            await apiCall("/api/attempts", "POST", {
                testId: activeTest.id,
                studentAnswers,
                reactivationsUsed: currentTestReactivations,
                isPractice: false,
            });
        } else if (activeTest.type === "writing") {
            const writingSection1 = document.getElementById("writingSection1")?.value?.trim() || "";
            const writingSection2 = document.getElementById("writingSection2")?.value?.trim() || "";
            await apiCall("/api/attempts", "POST", {
                testId: activeTest.id,
                writingSection1,
                writingSection2,
                reactivationsUsed: currentTestReactivations,
                isPractice: false,
            });
        } else {
            showFlash("Unknown test type", "error");
            return exitFullscreenTest();
        }
        userAttemptedTests.add(activeTest.id);
        showFlash(activeTest.type === "writing" ? "Submitted! Your teacher will grade your writing soon." : "Submitted! Results saved.", "success");
        exitFullscreenTest();
        await updateDashboard();
        if (document.getElementById("testsPage").style.display !== "none") displayAvailableTests();
    } catch (e) {
        showFlash(e.message, "error");
        exitFullscreenTest();
    }
}

async function checkReactivationCode() {
    const codeInput = document.getElementById("reactivationCodeInput");
    const enteredCode = codeInput.value.trim();
    const expectedCode = document.getElementById("reactivationPopup").dataset.expectedCode;
    if (!enteredCode) return showFlash("Enter reactivation code", "error");
    if (enteredCode !== expectedCode) return showFlash("Incorrect code!", "error");
    try {
        await apiCall("/api/session/reactivate", "POST", { violationId: currentViolationId, code: enteredCode });
        clearInterval(reactivationTimerInterval);
        document.getElementById("reactivationPopup").classList.remove("active");
        codeInput.value = "";
        currentTestReactivations += 1;
        violationTriggered = false;
        showFlash(`Reactivation #${currentTestReactivations}`, "success");
        const fullscreenDiv = document.getElementById("fullscreenTest");
        if (fullscreenDiv.requestFullscreen) fullscreenDiv.requestFullscreen();
    } catch (e) {
        showFlash(e.message, "error");
    }
}

function exitFullscreenTest() {
    isTestActive = false;
    clearInterval(reactivationTimerInterval);
    removeProctoringListeners();
    document.getElementById("reactivationPopup").classList.remove("active");
    document.getElementById("fullscreenTest").classList.remove("active");
    document.getElementById("fullscreenTestContent").innerHTML = "";
    if (document.exitFullscreen) document.exitFullscreen();
    activeTest = null;
    currentSessionId = null;
    currentViolationId = null;
}

async function saveNewTest() {
    const title = document.getElementById("testTitle").value.trim();
    const htmlCode = document.getElementById("testHtmlCode").value.trim();
    const type = document.getElementById("testType").value;
    const totalQuestions = parseInt(document.getElementById("totalQuestions").value, 10) || 40;
    const isPremium = document.getElementById("isPremium").checked;
    const needsPassword = document.getElementById("needsPassword").checked;
    const testPassword = document.getElementById("testPassword").value;
    const hasReactivation = document.getElementById("hasReactivation").checked;
    if (!title || !htmlCode) return showFlash("Enter title and HTML code", "error");
    const payload = { title, htmlCode, type, totalQuestions, isPremium, needsPassword, testPassword, hasReactivation };
    if (type === "reading" || type === "listening") {
        const key = collectAnswerKeyFromForm();
        if (key.some((g) => !g.length)) return showFlash("Each question needs at least one correct answer", "error");
        payload.answerKey = key;
    }
    try {
        await apiCall("/api/tests", "POST", payload);
        showFlash("Test added!", "success");
        await fetchTests();
        displayTeacherTests();
    } catch (e) {
        showFlash(e.message, "error");
    }
}

function displayTeacherTests() {
    const container = document.getElementById("teacherTestsList");
    if (allTests.length === 0) return (container.innerHTML = '<div class="empty-state">No tests created yet</div>');
    container.innerHTML = allTests.map((test) => {
        const showAns = teacherAnswersVisible[test.id];
        const key = test.answerKey;
        const keyBlock = (test.type === "reading" || test.type === "listening") && key && Array.isArray(key)
            ? `<div id="teacher-ans-${test.id}" style="display:${showAns ? "block" : "none"};margin-top:12px;padding:12px;background:rgba(0,0,0,0.25);border-radius:12px;font-size:13px;">
                ${key.map((g, idx) => `<div style="margin-bottom:6px;"><strong>Q${idx + 1}:</strong> ${(g || []).join(" · ")}</div>`).join("")}
            </div>`
            : "";
        return `
        <div class="test-card ${test.type}" style="padding:16px;">
            <div class="test-card-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                <div style="flex:1;"><span class="test-badge ${test.isPremium ? "badge-premium" : "badge-free"}">${test.isPremium ? "Premium" : "Free"}</span><span class="test-badge badge-${test.type}">${test.type}</span><span style="margin-left: 12px;">📄 ${test.title}</span>
                ${keyBlock}
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;">
                    ${(test.type === "reading" || test.type === "listening") && key ? `<button type="button" onclick="toggleTeacherAnswers(${test.id})" style="background:#0ea5e9;border:none;padding:6px 12px;border-radius:20px;color:white;cursor:pointer;">${showAns ? "Hide" : "Show"} answers</button>` : ""}
                    ${test.hasReactivation ? `<button onclick="showMonitoringPage(${test.id})" style="background:#8b5cf6;border:none;padding:6px 12px;border-radius:20px;color:white;cursor:pointer;">👁️ Monitor</button>` : ""}
                    <button class="delete-test" onclick="deleteTest(${test.id})" style="background:none;border:none;color:#ff6b6b;cursor:pointer;">Delete</button>
                </div>
            </div>
        </div>`;
    }).join("");
}

function toggleTeacherAnswers(testId) {
    teacherAnswersVisible[testId] = !teacherAnswersVisible[testId];
    displayTeacherTests();
}

async function deleteTest(testId) {
    if (!confirm("Delete this test?")) return;
    try {
        await apiCall(`/api/tests/${testId}`, "DELETE");
        await fetchTests();
        displayTeacherTests();
        displayAvailableTests();
    } catch (e) {
        showFlash(e.message, "error");
    }
}

async function displayActiveStudents() {
    try {
        const students = await apiCall("/api/students");
        const active = students.filter((s) => !s.banned);
        const container = document.getElementById("activeStudentsList");
        if (!active.length) return (container.innerHTML = '<div class="empty-state">No active students</div>');
        container.innerHTML = active.map((s) => `
            <div class="student-card">
                <div style="width:50px;height:50px;background:linear-gradient(135deg, var(--primary-red), var(--primary-dark));border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:16px;">${s.name.charAt(0).toUpperCase()}</div>
                <div style="font-weight:700;">${s.name}</div>
                <div style="color: var(--text-gray);">${s.email}</div>
                <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
                    <span class="test-badge badge-free">📝 ${s.testsTaken} tests</span>
                    <span class="test-badge badge-reading">⭐ ${s.avgBand} band</span>
                </div>
                <div style="margin-top:12px;display:flex;gap:8px;">
                    <button onclick="banStudent(${s.id})" style="background:#dc2626;border:none;padding:6px 14px;border-radius:25px;color:white;cursor:pointer;">Ban</button>
                    <button onclick="viewStudentDashboard(${s.id})" style="background:#3b82f6;border:none;padding:6px 14px;border-radius:25px;color:white;cursor:pointer;">View</button>
                </div>
            </div>
        `).join("");
    } catch (e) {
        showFlash("Failed to load students", "error");
    }
}

async function displayBannedStudents() {
    try {
        const students = await apiCall("/api/students");
        const banned = students.filter((s) => s.banned);
        const container = document.getElementById("bannedStudentsList");
        if (!banned.length) return (container.innerHTML = '<div class="empty-state">No banned students</div>');
        container.innerHTML = banned.map((s) => `
            <div class="student-card" style="opacity:.75;">
                <div style="font-weight:700;">${s.name} (BANNED)</div>
                <div style="color: var(--text-gray);">${s.email}</div>
                <div style="margin-top:12px;display:flex;gap:8px;">
                    <button onclick="unbanStudent(${s.id})" style="background:#10b981;border:none;padding:6px 14px;border-radius:25px;color:white;cursor:pointer;">Unban</button>
                    <button onclick="viewStudentDashboard(${s.id})" style="background:#3b82f6;border:none;padding:6px 14px;border-radius:25px;color:white;cursor:pointer;">View</button>
                </div>
            </div>
        `).join("");
    } catch (e) {
        showFlash("Failed to load banned students", "error");
    }
}

function setupStudentTabs() {
    document.querySelectorAll("[data-student-tab]").forEach((tab) => {
        tab.addEventListener("click", () => {
            document.querySelectorAll("[data-student-tab]").forEach((t) => t.classList.remove("active"));
            tab.classList.add("active");
            const tabType = tab.getAttribute("data-student-tab");
            if (tabType === "active") {
                document.getElementById("activeStudentsList").style.display = "grid";
                document.getElementById("bannedStudentsList").style.display = "none";
                displayActiveStudents();
            } else {
                document.getElementById("activeStudentsList").style.display = "none";
                document.getElementById("bannedStudentsList").style.display = "grid";
                displayBannedStudents();
            }
        });
    });
}

async function banStudent(studentId) {
    try {
        await apiCall(`/api/students/${studentId}/ban`, "POST");
        showFlash("Student banned", "success");
        displayActiveStudents();
        displayBannedStudents();
    } catch (e) {
        showFlash(e.message, "error");
    }
}

async function unbanStudent(studentId) {
    try {
        await apiCall(`/api/students/${studentId}/unban`, "POST");
        showFlash("Student unbanned", "success");
        displayActiveStudents();
        displayBannedStudents();
    } catch (e) {
        showFlash(e.message, "error");
    }
}

async function viewStudentDashboard(studentId) {
    try {
        const students = await apiCall("/api/students");
        const student = students.find((s) => s.id === studentId);
        if (!student) return showFlash("Student not found", "error");
        isViewingStudent = true;
        currentViewingStudentId = studentId;
        viewingStudentProfile = { id: student.id, name: student.name, email: student.email };
        showPage("dashboard");
    } catch (e) {
        showFlash("Failed to open student dashboard", "error");
    }
}

function exitStudentView() {
    isViewingStudent = false;
    currentViewingStudentId = null;
    viewingStudentProfile = null;
    showPage("dashboard");
}

let monitoringInterval = null;
let currentMonitoringTestId = null;

function showMonitoringPage(testId) {
    currentMonitoringTestId = testId;
    const test = allTests.find((t) => t.id === testId);
    let modal = document.getElementById("monitoringModal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "monitoringModal";
        modal.className = "modal";
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 800px; width: 90%;">
                <h2 style="margin-bottom: 16px;">👁️ Monitoring: <span id="monitorTestTitle"></span></h2>
                <div style="display:flex;gap:10px;margin-bottom:14px;">
                    <button id="monitorViolationsBtn" class="filter-chip active" onclick="setMonitorView('violations')">Violations</button>
                    <button id="monitorParticipantsBtn" class="filter-chip" onclick="setMonitorView('participants')">Participants</button>
                </div>
                <div id="monitorViolationsList" style="max-height: 400px; overflow-y: auto;"></div>
                <div id="monitorParticipantsList" style="max-height: 400px; overflow-y: auto; display:none;"></div>
                <button class="btn-primary" onclick="closeMonitoringPage()" style="margin-top: 20px;">Close</button>
            </div>
        `;
        document.body.appendChild(modal);
    }
    document.getElementById("monitorTestTitle").innerText = test?.title || "Test";
    modal.classList.add("active");
    setMonitorView("violations");
    fetchMonitoringData();
    monitoringInterval = setInterval(fetchMonitoringData, 2500);
}

function closeMonitoringPage() {
    clearInterval(monitoringInterval);
    const modal = document.getElementById("monitoringModal");
    if (modal) modal.classList.remove("active");
    currentMonitoringTestId = null;
}

async function fetchMonitoringData() {
    if (!currentMonitoringTestId) return;
    try {
        const violations = await apiCall(`/api/monitor/test/${currentMonitoringTestId}`);
        const container = document.getElementById("monitorViolationsList");
        if (!container) return;
        if (!violations.length) {
            container.innerHTML = '<div class="empty-state">No violations yet</div>';
            return;
        }
        container.innerHTML = violations.map((v) => {
            const state = v.reactivated ? `✅ ${Number(v.timeToReactivate || 0).toFixed(1)}s` : `⏳ ${Math.floor(v.timeElapsed || 0)}s`;
            return `<div style="padding:12px;border-bottom:1px solid var(--glass-border);display:flex;justify-content:space-between;align-items:center;">
                <span><strong>${v.studentName}</strong></span>
                <span style="font-family:monospace;font-size:20px;font-weight:bold;">${v.code}</span>
                <span>${state}</span>
            </div>`;
        }).join("");
    } catch (e) {
        showFlash("Error fetching monitoring data", "error");
    }
}

async function fetchParticipantsData() {
    if (!currentMonitoringTestId) return;
    try {
        const data = await apiCall(`/api/monitor/participants/${currentMonitoringTestId}`);
        renderParticipantsData(data);
    } catch (e) {
        showFlash("Error fetching participants", "error");
    }
}

function renderParticipantsData(data) {
    const container = document.getElementById("monitorParticipantsList");
    if (!container) return;
    const tt = data.testType || "";
    const participatingRows = (data.participating || []).map((s) => `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.startTime)}</td></tr>`).join("");
    const participatedRows = (data.participated || []).map((s) => {
        const checkBtn = s.needsWritingCheck
            ? `<button type="button" onclick="openWritingCheckModal(${s.attemptId})" style="background:#f59e0b;border:none;padding:4px 10px;border-radius:16px;color:#111;cursor:pointer;font-weight:600;">Check</button>`
            : "—";
        return `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.startTime)}</td><td>${escapeHtml(s.endTime)}</td><td>${escapeHtml(s.score)}</td><td>${tt === "writing" ? checkBtn : "—"}</td></tr>`;
    }).join("");
    const didntRows = (data.didntParticipate || []).map((s) => `<tr><td>${escapeHtml(s.name)}</td></tr>`).join("");

    container.innerHTML = `
        <div style="margin-bottom:18px;">
            <h3 style="margin-bottom:10px;">Participating</h3>
            <table style="width:100%;border-collapse:collapse;"><thead><tr><th style="text-align:left;padding:8px;">Full Name</th><th style="text-align:left;padding:8px;">Start Time</th></tr></thead><tbody>${participatingRows || '<tr><td colspan="2" style="padding:8px;color:var(--text-gray);">None</td></tr>'}</tbody></table>
        </div>
        <div style="margin-bottom:18px;">
            <h3 style="margin-bottom:10px;">Participated</h3>
            <table style="width:100%;border-collapse:collapse;"><thead><tr><th style="text-align:left;padding:8px;">Full Name</th><th style="text-align:left;padding:8px;">Start Time</th><th style="text-align:left;padding:8px;">End Time</th><th style="text-align:left;padding:8px;">Score</th><th style="text-align:left;padding:8px;">Writing</th></tr></thead><tbody>${participatedRows || '<tr><td colspan="5" style="padding:8px;color:var(--text-gray);">None</td></tr>'}</tbody></table>
        </div>
        <div>
            <h3 style="margin-bottom:10px;">Didn't Participate</h3>
            <table style="width:100%;border-collapse:collapse;"><thead><tr><th style="text-align:left;padding:8px;">Full Name</th></tr></thead><tbody>${didntRows || '<tr><td style="padding:8px;color:var(--text-gray);">None</td></tr>'}</tbody></table>
        </div>
    `;
}

function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
}

async function openWritingCheckModal(attemptId) {
    try {
        const d = await apiCall(`/api/attempts/writing-for-grade/${attemptId}`);
        document.getElementById("writingCheckAttemptId").value = attemptId;
        document.getElementById("writingCheckStudentName").textContent = d.studentName || "";
        document.getElementById("writingCheckSections").innerHTML = `
            <div style="margin-bottom:12px;"><strong>Section 1</strong><div style="white-space:pre-wrap;padding:12px;background:rgba(0,0,0,0.2);border-radius:8px;margin-top:6px;max-height:180px;overflow:auto;">${escapeHtml(d.section1)}</div></div>
            <div><strong>Section 2</strong><div style="white-space:pre-wrap;padding:12px;background:rgba(0,0,0,0.2);border-radius:8px;margin-top:6px;max-height:180px;overflow:auto;">${escapeHtml(d.section2)}</div></div>
        `;
        document.getElementById("writingScoreS1").value = "";
        document.getElementById("writingScoreS2").value = "";
        document.getElementById("writingCheckModal").classList.add("active");
    } catch (e) {
        showFlash(e.message, "error");
    }
}

function closeWritingCheckModal() {
    document.getElementById("writingCheckModal").classList.remove("active");
}

async function submitWritingGrade() {
    const attemptId = parseInt(document.getElementById("writingCheckAttemptId").value, 10);
    const scoreS1 = parseFloat(document.getElementById("writingScoreS1").value);
    const scoreS2 = parseFloat(document.getElementById("writingScoreS2").value);
    if (Number.isNaN(scoreS1) || Number.isNaN(scoreS2)) return showFlash("Enter both scores", "error");
    try {
        await apiCall("/api/attempts/writing-grade", "POST", { attemptId, scoreS1, scoreS2 });
        showFlash("Grade saved", "success");
        closeWritingCheckModal();
        fetchParticipantsData();
    } catch (e) {
        showFlash(e.message, "error");
    }
}

async function openTestResults(testId) {
    try {
        const d = await apiCall(`/api/attempts/result/${testId}`);
        const band = Number(d.bandScore);
        let rowBg = "rgba(220,38,38,0.25)";
        if (!d.writingPending) {
            if (band >= 7) rowBg = "rgba(16,185,129,0.25)";
            else if (band >= 5 && band < 7) rowBg = "rgba(234,179,8,0.3)";
            else rowBg = "rgba(220,38,38,0.25)";
        } else {
            rowBg = "rgba(107,114,128,0.3)";
        }
        const bandCell = d.writingPending ? "Pending teacher grade" : band.toFixed(1);
        const detail = d.detail || "";
        document.getElementById("resultsModalBody").innerHTML = `
            <p style="margin-bottom:12px;color:var(--text-gray);">${escapeHtml(d.testTitle)}</p>
            <table style="width:100%;border-collapse:collapse;">
                <thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid var(--glass-border);">Metric</th><th style="text-align:left;padding:8px;border-bottom:1px solid var(--glass-border);">Value</th></tr></thead>
                <tbody>
                    <tr style="background:${rowBg};"><td style="padding:10px;">Band / Result</td><td style="padding:10px;font-weight:700;">${escapeHtml(bandCell)}</td></tr>
                    <tr><td style="padding:10px;">Detail</td><td style="padding:10px;">${escapeHtml(detail)}</td></tr>
                </tbody>
            </table>`;
        document.getElementById("resultsModal").classList.add("active");
    } catch (e) {
        showFlash(e.message || "No results yet", "error");
    }
}

function closeResultsModal() {
    document.getElementById("resultsModal").classList.remove("active");
}

function setMonitorView(view) {
    const violationsBtn = document.getElementById("monitorViolationsBtn");
    const participantsBtn = document.getElementById("monitorParticipantsBtn");
    const violationsPanel = document.getElementById("monitorViolationsList");
    const participantsPanel = document.getElementById("monitorParticipantsList");
    if (!violationsBtn || !participantsBtn || !violationsPanel || !participantsPanel) return;
    if (view === "participants") {
        violationsBtn.classList.remove("active");
        participantsBtn.classList.add("active");
        violationsPanel.style.display = "none";
        participantsPanel.style.display = "block";
        fetchParticipantsData();
    } else {
        participantsBtn.classList.remove("active");
        violationsBtn.classList.add("active");
        participantsPanel.style.display = "none";
        violationsPanel.style.display = "block";
    }
}

async function showPage(page) {
    document.getElementById("homePage").style.display = "none";
    document.getElementById("authPage").style.display = "none";
    document.getElementById("dashboardPage").style.display = "none";
    document.getElementById("studentsPage").style.display = "none";
    document.getElementById("addTestPage").style.display = "none";
    document.getElementById("testsPage").style.display = "none";
    if (page === "home") document.getElementById("homePage").style.display = "block";
    else if (page === "dashboard") {
        document.getElementById("dashboardPage").style.display = "block";
        await updateDashboard();
    }
    else if (page === "students") {
        if (currentUser?.role !== "teacher") return showFlash("Teachers only", "error");
        document.getElementById("studentsPage").style.display = "block";
        setupStudentTabs();
        await displayActiveStudents();
        await displayBannedStudents();
    }
    else if (page === "addTest") {
        if (currentUser?.role !== "teacher") return showFlash("Teachers only", "error");
        await fetchTests();
        document.getElementById("addTestPage").style.display = "block";
        syncAnswerKeySectionVisibility();
        displayTeacherTests();
    }
    else if (page === "tests") {
        if (!currentUser) return showAuth("login");
        await fetchTests();
        document.getElementById("testsPage").style.display = "block";
        await loadUserAttempts();
        displayAvailableTests();
        setupFilters();
    }
    document.getElementById("dropdownMenu").classList.remove("show");
    closeMobileSidebar();
}

function showAuth(mode) {
    document.getElementById("homePage").style.display = "none";
    document.getElementById("dashboardPage").style.display = "none";
    document.getElementById("studentsPage").style.display = "none";
    document.getElementById("addTestPage").style.display = "none";
    document.getElementById("testsPage").style.display = "none";
    document.getElementById("authPage").style.display = "flex";
    const isLogin = mode === "login";
    document.getElementById("authTitle").innerHTML = isLogin ? '<i class="fas fa-sign-in-alt"></i> Login' : '<i class="fas fa-user-plus"></i> Register';
    document.getElementById("authName").style.display = isLogin ? "none" : "block";
    document.getElementById("authBtn").innerText = isLogin ? "Login" : "Register";
    document.getElementById("authSwitchText").innerHTML = isLogin ? "Don't have an account? " : "Already have an account? ";
    document.getElementById("authSwitchLink").innerText = isLogin ? "Register" : "Login";
    window.authMode = mode;
}

function switchAuthMode() { showAuth(window.authMode === "login" ? "register" : "login"); }
function toggleDropdown() { document.getElementById("dropdownMenu").classList.toggle("show"); }
function toggleTeacherMode() {
    if (!currentUser || currentUser.role !== "teacher") return;
    isTeacherMode = !isTeacherMode;
    if (isTeacherMode) showPage("students"); else showPage("dashboard");
    document.getElementById("dropdownMenu").classList.remove("show");
}
function openSettings() {
    document.getElementById("settingsModal").classList.add("active");
    document.getElementById("settingsName").value = currentUser?.name || "";
}
function closeSettings() { document.getElementById("settingsModal").classList.remove("active"); }
async function saveSettings() {
    const newName = document.getElementById("settingsName").value.trim();
    if (newName && currentUser) {
        try {
            const updated = await apiCall("/api/user/profile", "PUT", { name: newName });
            currentUser.name = updated.name;
            document.getElementById("profileCircle").innerText = newName.charAt(0).toUpperCase();
            showFlash("Profile updated!", "success");
        } catch (e) { showFlash(e.message, "error"); }
    }
    closeSettings();
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("mobileMenuBtn").addEventListener("click", openMobileSidebar);
    document.getElementById("closeSidebarBtn").addEventListener("click", closeMobileSidebar);
    document.getElementById("sidebarOverlay").addEventListener("click", closeMobileSidebar);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMobileSidebar(); });
    document.getElementById("needsPassword").addEventListener("change", (e) => {
        document.getElementById("passwordInputDiv").style.display = e.target.checked ? "block" : "none";
    });
    const ttEl = document.getElementById("testType");
    if (ttEl) ttEl.addEventListener("change", syncAnswerKeySectionVisibility);
    const tqEl = document.getElementById("totalQuestions");
    if (tqEl) tqEl.addEventListener("change", () => { if (document.getElementById("answerKeyBuilderWrap")?.style.display !== "none") renderAnswerKeyBuilder(); });
    window.onclick = function (event) {
        if (!event.target.closest(".profile-container")) document.getElementById("dropdownMenu").classList.remove("show");
        if (event.target === document.getElementById("settingsModal")) closeSettings();
        if (event.target === document.getElementById("practiceModal")) closePracticeModal();
        if (event.target === document.getElementById("monitoringModal")) closeMonitoringPage();
        if (event.target === document.getElementById("resultsModal")) closeResultsModal();
        if (event.target === document.getElementById("writingCheckModal")) closeWritingCheckModal();
    };
    loadData();
});
