import json
import random
from datetime import datetime, timedelta
from functools import wraps

from flask import Flask, jsonify, render_template, request, session
from sqlalchemy import text
from flask_bcrypt import Bcrypt
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
app.config["SECRET_KEY"] = "change-this-secret-key"
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///edunest.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)
bcrypt = Bcrypt(app)


class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    role = db.Column(db.String(20), default="student")
    premium = db.Column(db.Boolean, default=False)
    banned = db.Column(db.Boolean, default=False)
    tests_taken = db.relationship("TestAttempt", backref="user", lazy=True)
    active_sessions = db.relationship("TestSession", backref="user", lazy=True)

    def set_password(self, password):
        self.password_hash = bcrypt.generate_password_hash(password).decode("utf-8")

    def check_password(self, password):
        return bcrypt.check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "role": self.role,
            "premium": self.premium,
            "banned": self.banned,
        }


class Test(db.Model):
    __tablename__ = "tests"
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    html_code = db.Column(db.Text, nullable=False)
    type = db.Column(db.String(20), nullable=False)
    total_questions = db.Column(db.Integer, default=40)
    is_premium = db.Column(db.Boolean, default=False)
    needs_password = db.Column(db.Boolean, default=False)
    test_password = db.Column(db.String(100))
    has_reactivation = db.Column(db.Boolean, default=False)
    answer_key = db.Column(db.Text)

    def to_dict(self, include_answer_key=False):
        d = {
            "id": self.id,
            "title": self.title,
            "htmlCode": self.html_code,
            "type": self.type,
            "totalQuestions": self.total_questions,
            "isPremium": self.is_premium,
            "needsPassword": self.needs_password,
            "testPassword": self.test_password,
            "hasReactivation": self.has_reactivation,
            "hasAnswerKey": bool(self.answer_key),
        }
        if include_answer_key and self.answer_key:
            try:
                d["answerKey"] = json.loads(self.answer_key)
            except json.JSONDecodeError:
                d["answerKey"] = None
        return d


class TestAttempt(db.Model):
    __tablename__ = "test_attempts"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    test_id = db.Column(db.Integer, db.ForeignKey("tests.id"), nullable=False)
    score = db.Column(db.Integer, default=0)
    total = db.Column(db.Integer, default=0)
    band_score = db.Column(db.Float, default=0.0)
    reactivations_used = db.Column(db.Integer, default=0)
    is_practice = db.Column(db.Boolean, default=False)
    completed_at = db.Column(db.DateTime, default=datetime.utcnow)
    student_answers_json = db.Column(db.Text)
    writing_section1 = db.Column(db.Text)
    writing_section2 = db.Column(db.Text)
    writing_checked = db.Column(db.Boolean, default=True)
    test = db.relationship("Test", backref="attempts")


class TestSession(db.Model):
    __tablename__ = "test_sessions"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    test_id = db.Column(db.Integer, db.ForeignKey("tests.id"), nullable=False)
    started_at = db.Column(db.DateTime, default=datetime.utcnow)
    is_active = db.Column(db.Boolean, default=True)
    violations = db.relationship("Violation", backref="session", lazy=True)


class Violation(db.Model):
    __tablename__ = "violations"
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey("test_sessions.id"), nullable=False)
    violation_time = db.Column(db.DateTime, default=datetime.utcnow)
    reactivation_code = db.Column(db.String(4))
    reactivated_at = db.Column(db.DateTime, nullable=True)
    resolved = db.Column(db.Boolean, default=False)


def band_from_percent(percentage):
    if percentage >= 90:
        return 9.0
    if percentage >= 83:
        return 8.5
    if percentage >= 78:
        return 8.0
    if percentage >= 73:
        return 7.5
    if percentage >= 68:
        return 7.0
    if percentage >= 63:
        return 6.5
    if percentage >= 58:
        return 6.0
    if percentage >= 53:
        return 5.5
    if percentage >= 48:
        return 5.0
    if percentage >= 40:
        return 4.5
    if percentage >= 30:
        return 4.0
    return 3.5


def migrate_sqlite_columns():
    """Add columns on existing SQLite DBs (ignore if already present)."""
    statements = [
        "ALTER TABLE tests ADD COLUMN answer_key TEXT",
        "ALTER TABLE test_attempts ADD COLUMN student_answers_json TEXT",
        "ALTER TABLE test_attempts ADD COLUMN writing_section1 TEXT",
        "ALTER TABLE test_attempts ADD COLUMN writing_section2 TEXT",
        "ALTER TABLE test_attempts ADD COLUMN writing_checked BOOLEAN DEFAULT 1",
    ]
    with db.engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
            except Exception:
                pass


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)

    return decorated_function


def teacher_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "Unauthorized"}), 401
        user = User.query.get(session["user_id"])
        if not user or user.role != "teacher":
            return jsonify({"error": "Forbidden"}), 403
        return f(*args, **kwargs)

    return decorated_function


@app.route("/")
def home_page():
    return render_template("home.html", initial_page="home")


@app.route("/login")
def login_page():
    return render_template("login.html", initial_page="login")


@app.route("/register")
def register_page():
    return render_template("register.html", initial_page="register")


@app.route("/dashboard")
def dashboard_page():
    return render_template("dashboard.html", initial_page="dashboard")


@app.route("/tests-page")
def tests_page():
    return render_template("tests.html", initial_page="tests")


@app.route("/students")
def students_page():
    return render_template("students.html", initial_page="students")


@app.route("/add-test")
def add_test_page():
    return render_template("add_test.html", initial_page="addTest")


@app.route("/monitor")
def monitor_page():
    return render_template("monitor.html", initial_page="tests")


@app.route("/api/auth/register", methods=["POST"])
def register():
    data = request.get_json()
    name = data.get("name")
    email = data.get("email")
    password = data.get("password")
    if not name or not email or not password:
        return jsonify({"error": "Missing fields"}), 400
    if User.query.filter_by(email=email).first():
        return jsonify({"error": "Email already registered"}), 400
    user = User(name=name, email=email, role="student")
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    session["user_id"] = user.id
    return jsonify(user.to_dict())


@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json()
    email = data.get("email")
    password = data.get("password")
    user = User.query.filter_by(email=email).first()
    if not user or not user.check_password(password):
        return jsonify({"error": "Invalid credentials"}), 401
    if user.banned:
        return jsonify({"error": "Account banned"}), 403
    session["user_id"] = user.id
    return jsonify(user.to_dict())


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.pop("user_id", None)
    return jsonify({"message": "Logged out"})


@app.route("/api/auth/me")
def get_current_user():
    if "user_id" not in session:
        return jsonify({"user": None})
    user = User.query.get(session["user_id"])
    return jsonify({"user": user.to_dict() if user else None})


@app.route("/api/auth/google", methods=["POST"])
def google_auth():
    data = request.get_json()
    email = data.get("email")
    name = data.get("name")
    uid = data.get("uid")
    if not email or not uid:
        return jsonify({"error": "Missing fields"}), 400
    user = User.query.filter_by(email=email).first()
    if not user:
        user = User(name=name or email.split("@")[0], email=email, role="student")
        user.set_password("google_oauth_" + uid)
        db.session.add(user)
        db.session.commit()
    elif user.banned:
        return jsonify({"error": "Account banned"}), 403
    session["user_id"] = user.id
    return jsonify(user.to_dict())


@app.route("/api/user/profile", methods=["PUT"])
@login_required
def update_profile():
    data = request.get_json()
    user = User.query.get(session["user_id"])
    if not user:
        return jsonify({"error": "User not found"}), 404
    if "name" in data:
        user.name = data["name"]
    db.session.commit()
    return jsonify(user.to_dict())


@app.route("/api/user/upgrade", methods=["POST"])
@login_required
def upgrade_premium():
    return jsonify({"error": "Premium features are currently disabled"}), 403


@app.route("/api/tests", methods=["GET"])
@login_required
def get_tests():
    user = User.query.get(session["user_id"])
    is_teacher = user and user.role == "teacher"
    tests = Test.query.all()
    return jsonify([t.to_dict(include_answer_key=is_teacher) for t in tests])


@app.route("/api/tests", methods=["POST"])
@teacher_required
def create_test():
    data = request.get_json()
    tq = int(data.get("totalQuestions", 40))
    answer_key_json = None
    if data.get("type") in ("reading", "listening"):
        key = data.get("answerKey")
        if not key or not isinstance(key, list) or len(key) != tq:
            return jsonify({"error": f"Provide answerKey with exactly {tq} question groups"}), 400
        for group in key:
            if not isinstance(group, list) or not group or not all(isinstance(x, str) and x.strip() for x in group):
                return jsonify({"error": "Each answer group must be a non-empty list of strings"}), 400
        answer_key_json = json.dumps(key)
    test = Test(
        title=data["title"],
        html_code=data["htmlCode"],
        type=data["type"],
        total_questions=tq,
        is_premium=data.get("isPremium", False),
        needs_password=data.get("needsPassword", False),
        test_password=data.get("testPassword"),
        has_reactivation=data.get("hasReactivation", False),
        answer_key=answer_key_json,
    )
    db.session.add(test)
    db.session.commit()
    return jsonify(test.to_dict(include_answer_key=True))


@app.route("/api/tests/<int:test_id>", methods=["DELETE"])
@teacher_required
def delete_test(test_id):
    test = Test.query.get_or_404(test_id)
    db.session.delete(test)
    db.session.commit()
    return jsonify({"message": "Test deleted"})


@app.route("/api/attempts", methods=["POST"])
@login_required
def submit_attempt():
    data = request.get_json()
    test = Test.query.get_or_404(data["testId"])
    user = User.query.get(session["user_id"])
    if data.get("isPractice", False):
        return jsonify({"message": "Practice not saved"})
    existing = TestAttempt.query.filter_by(user_id=user.id, test_id=test.id, is_practice=False).first()
    if existing:
        return jsonify({"error": "Test already taken"}), 400
    is_practice = False
    reactiv = data.get("reactivationsUsed", 0)

    if test.type in ("reading", "listening"):
        if not test.answer_key:
            return jsonify({"error": "Test has no answer key configured"}), 400
        student_answers = data.get("studentAnswers")
        if not student_answers or not isinstance(student_answers, list):
            return jsonify({"error": "studentAnswers required"}), 400
        key = json.loads(test.answer_key)
        n = test.total_questions
        if len(key) != n or len(student_answers) != n:
            return jsonify({"error": f"Expected {n} answers"}), 400
        score = 0
        for i in range(n):
            accepted_raw = key[i]
            accepted = accepted_raw if isinstance(accepted_raw, list) else [accepted_raw]
            accepted_norm = [str(a).strip().lower() for a in accepted if str(a).strip()]
            student_val = str(student_answers[i] or "").strip().lower()
            if any(student_val == a for a in accepted_norm):
                score += 1
        total = n
        percentage = (score / total) * 100 if total else 0
        band_score = band_from_percent(percentage)
        attempt = TestAttempt(
            user_id=user.id,
            test_id=test.id,
            score=score,
            total=total,
            band_score=band_score,
            reactivations_used=reactiv,
            is_practice=False,
            student_answers_json=json.dumps(student_answers),
            writing_checked=True,
        )
    elif test.type == "writing":
        ws1 = (data.get("writingSection1") or "").strip()
        ws2 = (data.get("writingSection2") or "").strip()
        if not ws1 or not ws2:
            return jsonify({"error": "Both writing sections are required"}), 400
        attempt = TestAttempt(
            user_id=user.id,
            test_id=test.id,
            score=0,
            total=2,
            band_score=0.0,
            reactivations_used=reactiv,
            is_practice=False,
            writing_section1=ws1,
            writing_section2=ws2,
            writing_checked=False,
        )
    else:
        return jsonify({"error": "Unknown test type"}), 400

    db.session.add(attempt)
    TestSession.query.filter_by(user_id=user.id, test_id=test.id, is_active=True).update({"is_active": False})
    db.session.commit()
    return jsonify({"message": "Attempt saved", "attemptId": attempt.id})


@app.route("/api/attempts/writing-grade", methods=["POST"])
@teacher_required
def grade_writing():
    data = request.get_json()
    attempt_id = data.get("attemptId")
    s1 = data.get("scoreS1")
    s2 = data.get("scoreS2")
    if attempt_id is None or s1 is None or s2 is None:
        return jsonify({"error": "attemptId, scoreS1, scoreS2 required"}), 400
    attempt = TestAttempt.query.get_or_404(attempt_id)
    test = attempt.test
    if test.type != "writing":
        return jsonify({"error": "Not a writing attempt"}), 400
    try:
        fs1 = float(s1)
        fs2 = float(s2)
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid scores"}), 400
    res = (fs1 + fs2 * 2) / 3.0
    if getattr(attempt, "writing_checked", False):
        return jsonify({"error": "Already graded"}), 400
    attempt.band_score = round(res, 2)
    attempt.score = int(round(res))
    attempt.total = 9
    attempt.writing_checked = True
    db.session.commit()
    return jsonify({"bandScore": attempt.band_score, "score": attempt.score})


@app.route("/api/attempts/writing-for-grade/<int:attempt_id>", methods=["GET"])
@teacher_required
def writing_for_grade(attempt_id):
    attempt = TestAttempt.query.get_or_404(attempt_id)
    if attempt.test.type != "writing":
        return jsonify({"error": "Not writing"}), 400
    user = User.query.get(attempt.user_id)
    return jsonify(
        {
            "attemptId": attempt.id,
            "studentName": user.name if user else "",
            "section1": attempt.writing_section1 or "",
            "section2": attempt.writing_section2 or "",
            "alreadyGraded": getattr(attempt, "writing_checked", True),
        }
    )


@app.route("/api/attempts/result/<int:test_id>", methods=["GET"])
@login_required
def attempt_result_for_test(test_id):
    user = User.query.get(session["user_id"])
    attempt = TestAttempt.query.filter_by(user_id=user.id, test_id=test_id, is_practice=False).first()
    if not attempt:
        return jsonify({"error": "No attempt found"}), 404
    test = attempt.test
    writing_pending = test.type == "writing" and not getattr(attempt, "writing_checked", True)
    detail = ""
    if test.type == "writing":
        detail = "Awaiting teacher grade" if writing_pending else f"Band {attempt.band_score:.2f} (scores combined)"
    else:
        detail = f"{attempt.score}/{attempt.total} correct"
    return jsonify(
        {
            "testTitle": test.title,
            "type": test.type,
            "score": attempt.score,
            "total": attempt.total,
            "bandScore": attempt.band_score,
            "writingPending": writing_pending,
            "detail": detail,
        }
    )


@app.route("/api/attempts/user", methods=["GET"])
@login_required
def get_user_attempts():
    user = User.query.get(session["user_id"])
    attempts = TestAttempt.query.filter_by(user_id=user.id, is_practice=False).all()
    result = []
    for a in attempts:
        t = a.test
        wp = t.type == "writing" and not getattr(a, "writing_checked", True)
        result.append(
            {
                "testId": a.test_id,
                "testTitle": t.title,
                "score": a.score,
                "total": a.total,
                "bandScore": a.band_score,
                "reactivationsUsed": a.reactivations_used,
                "writingPending": wp,
                "testType": t.type,
            }
        )
    return jsonify(result)


@app.route("/api/attempts/user/<int:user_id>", methods=["GET"])
@teacher_required
def get_student_attempts(user_id):
    student = User.query.get_or_404(user_id)
    if student.role != "student":
        return jsonify({"error": "Not a student"}), 400
    attempts = TestAttempt.query.filter_by(user_id=student.id, is_practice=False).all()
    result = []
    for a in attempts:
        t = a.test
        wp = t.type == "writing" and not getattr(a, "writing_checked", True)
        result.append(
            {
                "testId": a.test_id,
                "testTitle": t.title,
                "score": a.score,
                "total": a.total,
                "bandScore": a.band_score,
                "reactivationsUsed": a.reactivations_used,
                "writingPending": wp,
                "testType": t.type,
            }
        )
    return jsonify(result)


@app.route("/api/attempts/reset", methods=["POST"])
@teacher_required
def reset_test_attempt():
    data = request.get_json()
    student_id = data["studentId"]
    test_id = data["testId"]
    attempts = TestAttempt.query.filter_by(user_id=student_id, test_id=test_id, is_practice=False).all()
    for attempt in attempts:
        db.session.delete(attempt)
    db.session.commit()
    return jsonify({"message": "Test reset"})


@app.route("/api/students", methods=["GET"])
@teacher_required
def get_students():
    students = User.query.filter_by(role="student").all()
    result = []
    for s in students:
        attempts = TestAttempt.query.filter_by(user_id=s.id, is_practice=False).all()
        tests_taken = len(attempts)
        total_score = sum(a.score for a in attempts)
        total_band = sum(a.band_score for a in attempts)
        total_reactivations = sum(a.reactivations_used for a in attempts)
        result.append(
            {
                "id": s.id,
                "name": s.name,
                "email": s.email,
                "banned": s.banned,
                "testsTaken": tests_taken,
                "avgBand": round(total_band / tests_taken, 1) if tests_taken else 0.0,
                "totalScore": total_score,
                "totalReactivations": total_reactivations,
            }
        )
    return jsonify(result)


@app.route("/api/students/<int:student_id>/ban", methods=["POST"])
@teacher_required
def ban_student(student_id):
    student = User.query.get_or_404(student_id)
    if student.role != "student":
        return jsonify({"error": "Not a student"}), 400
    student.banned = True
    db.session.commit()
    return jsonify({"message": "Student banned"})


@app.route("/api/students/<int:student_id>/unban", methods=["POST"])
@teacher_required
def unban_student(student_id):
    student = User.query.get_or_404(student_id)
    if student.role != "student":
        return jsonify({"error": "Not a student"}), 400
    student.banned = False
    db.session.commit()
    return jsonify({"message": "Student unbanned"})


@app.route("/api/session/start", methods=["POST"])
@login_required
def start_session():
    test_id = request.get_json()["testId"]
    user_id = session["user_id"]
    TestSession.query.filter_by(user_id=user_id, test_id=test_id, is_active=True).update({"is_active": False})
    sess = TestSession(user_id=user_id, test_id=test_id)
    db.session.add(sess)
    db.session.commit()
    return jsonify({"sessionId": sess.id})


@app.route("/api/session/violation", methods=["POST"])
@login_required
def report_violation():
    session_id = request.get_json().get("sessionId")
    session_obj = TestSession.query.get_or_404(session_id)
    if session_obj.user_id != session["user_id"]:
        return jsonify({"error": "Unauthorized"}), 403
    code = str(random.randint(1000, 9999))
    v = Violation(session_id=session_obj.id, reactivation_code=code)
    db.session.add(v)
    db.session.commit()
    return jsonify({"violationId": v.id, "code": code})


@app.route("/api/session/reactivate", methods=["POST"])
@login_required
def reactivate():
    data = request.get_json()
    violation = Violation.query.get_or_404(data["violationId"])
    if violation.session.user_id != session["user_id"]:
        return jsonify({"error": "Unauthorized"}), 403
    if violation.resolved:
        return jsonify({"error": "Already reactivated"}), 400
    if violation.reactivation_code != data["code"]:
        return jsonify({"error": "Incorrect code"}), 400
    violation.reactivated_at = datetime.utcnow()
    violation.resolved = True
    db.session.commit()
    return jsonify({"success": True})


@app.route("/api/session/pending", methods=["GET"])
@login_required
def pending_violation():
    user_id = session["user_id"]
    violation = (
        Violation.query.join(TestSession, Violation.session_id == TestSession.id)
        .filter(
            TestSession.user_id == user_id,
            TestSession.is_active.is_(True),
            Violation.resolved.is_(False),
        )
        .order_by(Violation.violation_time.desc())
        .first()
    )
    if not violation:
        return jsonify({"pending": None})

    elapsed = int((datetime.utcnow() - violation.violation_time).total_seconds())
    remaining = max(0, 60 - elapsed)
    return jsonify(
        {
            "pending": {
                "violationId": violation.id,
                "code": violation.reactivation_code,
                "remainingSeconds": remaining,
            }
        }
    )


@app.route("/api/monitor/test/<int:test_id>", methods=["GET"])
@teacher_required
def monitor_test(test_id):
    recent = datetime.utcnow() - timedelta(minutes=10)
    violations = Violation.query.filter(Violation.session.has(test_id=test_id)).all()
    data = []
    for v in violations:
        if not v.resolved:
            data.append(
                {
                    "violationId": v.id,
                    "studentName": v.session.user.name,
                    "code": v.reactivation_code,
                    "reactivated": False,
                    "timeElapsed": (datetime.utcnow() - v.violation_time).total_seconds(),
                }
            )
        elif v.reactivated_at and v.reactivated_at >= recent:
            data.append(
                {
                    "violationId": v.id,
                    "studentName": v.session.user.name,
                    "code": v.reactivation_code,
                    "reactivated": True,
                    "timeToReactivate": (v.reactivated_at - v.violation_time).total_seconds(),
                }
            )
    return jsonify(data)


@app.route("/api/monitor/participants/<int:test_id>", methods=["GET"])
@teacher_required
def monitor_participants(test_id):
    test = Test.query.get_or_404(test_id)
    students = User.query.filter_by(role="student", banned=False).all()
    sessions = TestSession.query.filter_by(test_id=test_id).all()
    attempts = TestAttempt.query.filter_by(test_id=test_id, is_practice=False).all()

    sessions_by_user = {}
    for s in sessions:
        if s.user_id not in sessions_by_user:
            sessions_by_user[s.user_id] = []
        sessions_by_user[s.user_id].append(s)

    attempts_by_user = {}
    for a in attempts:
        prev = attempts_by_user.get(a.user_id)
        if prev is None or (a.completed_at and prev.completed_at and a.completed_at > prev.completed_at):
            attempts_by_user[a.user_id] = a

    participating = []
    participated = []
    didnt_participate = []

    for student in students:
        user_sessions = sessions_by_user.get(student.id, [])
        latest_session = max(user_sessions, key=lambda x: x.started_at) if user_sessions else None
        attempt = attempts_by_user.get(student.id)

        if attempt:
            start_time = latest_session.started_at if latest_session else attempt.completed_at
            needs_writing = test.type == "writing" and not getattr(attempt, "writing_checked", True)
            if needs_writing:
                score_str = "Pending grading"
            else:
                score_str = f"Band {attempt.band_score} ({attempt.score}/{attempt.total})"
            participated.append(
                {
                    "userId": student.id,
                    "attemptId": attempt.id,
                    "name": student.name,
                    "startTime": start_time.strftime("%H:%M") if start_time else "-",
                    "endTime": attempt.completed_at.strftime("%H:%M") if attempt.completed_at else "-",
                    "score": score_str,
                    "needsWritingCheck": needs_writing,
                    "testType": test.type,
                }
            )
        elif latest_session:
            participating.append(
                {
                    "name": student.name,
                    "startTime": latest_session.started_at.strftime("%H:%M") if latest_session.started_at else "-",
                }
            )
        else:
            didnt_participate.append({"name": student.name})

    return jsonify(
        {
            "participating": participating,
            "participated": participated,
            "didntParticipate": didnt_participate,
            "testType": test.type,
        }
    )


if __name__ == "__main__":
    with app.app_context():
        db.create_all()
        migrate_sqlite_columns()
        if not User.query.filter_by(email="teacher@edunest.com").first():
            teacher = User(name="Teacher", email="teacher@edunest.com", role="teacher", premium=True)
            teacher.set_password("teacher123")
            db.session.add(teacher)
            db.session.commit()
    app.run(debug=True)
