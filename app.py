import json
import uuid
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
EXERCISES_FILE = DATA_DIR / "exercises.json"
SESSIONS_FILE = DATA_DIR / "workout_sessions.json"
MUSCLE_GROUPS_FILE = DATA_DIR / "muscle_groups.json"

WORKOUT_TYPES = ["push", "pull", "legs", "core", "custom"]

EXPECTED_GROUPS = {
    "push": ["chest", "shoulders", "triceps"],
    "pull": ["back", "biceps", "forearms"],
    "legs": ["glutes", "quadriceps", "hamstrings", "adductors", "abductors", "calves"],
    "core": ["upper abs", "lower abs", "obliques", "transverse abdominis", "hip flexors"],
    "custom": [],
}

EXERCISE_KEYWORD_MAP = {
    "bench press": ("push", "chest", "middle chest", ["triceps", "front deltoid"]),
    "incline bench": ("push", "chest", "upper chest", ["triceps", "front deltoid"]),
    "decline bench": ("push", "chest", "lower chest", ["triceps"]),
    "shoulder press": ("push", "shoulders", "front deltoid", ["triceps"]),
    "lateral raise": ("push", "shoulders", "side deltoid", []),
    "rear delt fly": ("pull", "back", "rear delts", ["shoulders"]),
    "tricep pushdown": ("push", "triceps", "lateral head", []),
    "overhead tricep": ("push", "triceps", "long head", []),
    "lat pulldown": ("pull", "back", "lats", ["biceps"]),
    "seated row": ("pull", "back", "rhomboids", ["biceps"]),
    "barbell row": ("pull", "back", "lats", ["biceps"]),
    "deadlift": ("pull", "back", "lower back", ["hamstrings", "glutes"]),
    "bicep curl": ("pull", "biceps", "biceps brachii", []),
    "hammer curl": ("pull", "biceps", "brachialis", ["forearms"]),
    "wrist curl": ("pull", "forearms", "wrist flexors", []),
    "squat": ("legs", "quadriceps", "quadriceps", ["glutes", "hamstrings"]),
    "leg press": ("legs", "quadriceps", "quadriceps", ["glutes"]),
    "leg curl": ("legs", "hamstrings", "hamstrings", []),
    "leg extension": ("legs", "quadriceps", "quadriceps", []),
    "calf raise": ("legs", "calves", "gastrocnemius", ["soleus"]),
    "hip thrust": ("legs", "glutes", "gluteus maximus", []),
    "plank": ("core", "transverse abdominis", "transverse abdominis", ["upper abs"]),
    "crunch": ("core", "upper abs", "upper abs", []),
    "leg raise": ("core", "lower abs", "lower abs", ["hip flexors"]),
}


# --------------------- Utility Helpers ---------------------
def ensure_json_file(path: Path, default_data):
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(default_data, indent=2), encoding="utf-8")


def read_json(path: Path, default_data=None):
    if default_data is None:
        default_data = []
    ensure_json_file(path, default_data)
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(data, file, indent=2)


def normalize(value):
    return (value or "").strip().lower()


def convert_weight(weight, from_unit, to_unit):
    try:
        weight = float(weight)
    except (TypeError, ValueError):
        return None

    from_unit = normalize(from_unit)
    to_unit = normalize(to_unit)

    if from_unit == to_unit:
        return round(weight, 2)

    if from_unit == "kg" and to_unit == "lbs":
        return round(weight * 2.20462, 2)
    if from_unit == "lbs" and to_unit == "kg":
        return round(weight / 2.20462, 2)

    return None


def map_exercise_by_name(name):
    search_name = normalize(name)
    for keyword, mapped in EXERCISE_KEYWORD_MAP.items():
        if keyword in search_name:
            workout_type, muscle_group, sub_group, secondary = mapped
            return {
                "matched": True,
                "confidence": "high",
                "workout_type": workout_type,
                "muscle_group": muscle_group,
                "sub_muscle_group": sub_group,
                "secondary_muscle_groups": secondary,
            }

    return {
        "matched": False,
        "confidence": "low",
        "message": "No confident match found. Please select muscle group manually.",
    }


def normalize_muscle_group(value):
    return normalize(value).replace("deltoids", "delts")


def get_trained_primary_groups(session):
    groups = set()
    for exercise in session.get("exercises", []):
        if exercise.get("completed"):
            mg = normalize_muscle_group(exercise.get("muscle_group"))
            if mg:
                groups.add(mg)
    return groups


def analyze_post_workout(session, sessions, exercise_library):
    workout_type = normalize(session.get("workout_type"))
    expected = EXPECTED_GROUPS.get(workout_type, [])
    trained_groups = get_trained_primary_groups(session)

    missing_this_session = [g for g in expected if normalize_muscle_group(g) not in trained_groups]

    same_type_sessions = [s for s in sessions if normalize(s.get("workout_type")) == workout_type]
    same_type_sessions_sorted = sorted(
        same_type_sessions,
        key=lambda s: s.get("date", ""),
        reverse=True,
    )

    recent_n = 3
    recent_sessions = same_type_sessions_sorted[:recent_n]
    missing_across_recent = []
    if len(recent_sessions) >= recent_n:
        for group in expected:
            group_key = normalize_muscle_group(group)
            trained_in_any = any(group_key in get_trained_primary_groups(s) for s in recent_sessions)
            if not trained_in_any:
                missing_across_recent.append(group)

    all_counter = Counter()
    for past_session in sessions:
        all_counter.update(get_trained_primary_groups(past_session))

    if all_counter:
        avg = sum(all_counter.values()) / max(len(all_counter), 1)
        under_trained = [g for g, c in all_counter.items() if c < avg * 0.65]
        over_trained = [g for g, c in all_counter.items() if c > avg * 1.4]
    else:
        under_trained = []
        over_trained = []

    recommendations = []
    recommendation_groups = set(missing_this_session + missing_across_recent + under_trained)
    for exercise in exercise_library:
        primary = normalize_muscle_group(exercise.get("primary_muscle_group"))
        if primary in recommendation_groups:
            recommendations.append(
                {
                    "name": exercise.get("name"),
                    "workout_type": exercise.get("workout_type"),
                    "primary_muscle_group": exercise.get("primary_muscle_group"),
                }
            )
        if len(recommendations) >= 6:
            break

    insight_lines = []
    if expected:
        trained_in_expected = [g for g in expected if normalize_muscle_group(g) in trained_groups]
        if missing_this_session:
            insight_lines.append(
                f"In this {workout_type.title()} Day, {', '.join(trained_in_expected) or 'no key groups'} were trained, "
                f"but {', '.join(missing_this_session)} were not trained."
            )
        else:
            insight_lines.append(
                f"Great balance: all major {workout_type.title()} groups were covered in this session."
            )

    for group in missing_across_recent:
        insight_lines.append(
            f"{group.title()} have not been trained in the last {recent_n} {workout_type.title()} workouts."
        )

    return {
        "insights": insight_lines,
        "missing_this_session": missing_this_session,
        "missing_last_three": missing_across_recent,
        "under_trained": sorted(under_trained),
        "over_trained": sorted(over_trained),
        "optional_recommendations": recommendations,
    }


def get_dashboard_data(sessions):
    total_workouts = len(sessions)
    total_exercises = sum(len(s.get("exercises", [])) for s in sessions)

    group_counter = Counter()
    type_coverage = Counter()
    recent_sessions = sorted(sessions, key=lambda x: x.get("date", ""), reverse=True)[:5]

    weekly_counter = defaultdict(int)

    for session in sessions:
        date_str = session.get("date")
        try:
            dt = datetime.fromisoformat(date_str)
        except Exception:
            continue

        iso_year, iso_week, _ = dt.isocalendar()
        weekly_counter[f"{iso_year}-W{iso_week}"] += 1

        w_type = normalize(session.get("workout_type"))
        if w_type in WORKOUT_TYPES:
            type_coverage[w_type] += 1

        for group in get_trained_primary_groups(session):
            group_counter[group] += 1

    most_trained = group_counter.most_common(1)[0][0].title() if group_counter else "-"
    least_trained = group_counter.most_common()[-1][0].title() if group_counter else "-"

    weekly_summary = [
        {"week": week, "count": count}
        for week, count in sorted(weekly_counter.items(), reverse=True)[:6]
    ]

    return {
        "total_workouts": total_workouts,
        "total_exercises": total_exercises,
        "most_trained": most_trained,
        "least_trained": least_trained,
        "recent_sessions": recent_sessions,
        "weekly_summary": list(reversed(weekly_summary)),
        "coverage": {
            "push": type_coverage.get("push", 0),
            "pull": type_coverage.get("pull", 0),
            "legs": type_coverage.get("legs", 0),
            "core": type_coverage.get("core", 0),
            "custom": type_coverage.get("custom", 0),
        },
    }


def get_progress_data(sessions):
    progress = defaultdict(lambda: {
        "last_lifted_weight": None,
        "last_unit": "kg",
        "best_lifted_weight_kg": 0,
        "total_sets": 0,
        "total_reps": 0,
        "history": [],
    })

    sorted_sessions = sorted(sessions, key=lambda x: x.get("date", ""))

    for session in sorted_sessions:
        session_date = session.get("date")
        for exercise in session.get("exercises", []):
            if not exercise.get("completed"):
                continue

            name = exercise.get("exercise_name")
            if not name:
                continue

            entry = progress[name]
            weight = exercise.get("weight")
            unit = exercise.get("weight_unit", "kg")
            sets = int(exercise.get("sets", 0) or 0)
            reps = int(exercise.get("reps", 0) or 0)

            entry["last_lifted_weight"] = weight
            entry["last_unit"] = unit
            entry["total_sets"] += sets
            entry["total_reps"] += reps

            weight_in_kg = convert_weight(weight, unit, "kg")
            if weight_in_kg is not None and weight_in_kg > entry["best_lifted_weight_kg"]:
                entry["best_lifted_weight_kg"] = weight_in_kg

            entry["history"].append(
                {
                    "date": session_date,
                    "weight": weight,
                    "weight_unit": unit,
                    "weight_kg": weight_in_kg,
                    "sets": sets,
                    "reps": reps,
                }
            )

    response = []
    for name, entry in progress.items():
        history = entry["history"]
        improvement = 0
        if len(history) >= 2:
            first = history[0].get("weight_kg") or 0
            last = history[-1].get("weight_kg") or 0
            improvement = round(last - first, 2)

        best_kg = entry["best_lifted_weight_kg"]
        best_lbs = convert_weight(best_kg, "kg", "lbs") if best_kg else 0

        response.append(
            {
                "exercise_name": name,
                "last_lifted_weight": entry["last_lifted_weight"],
                "last_unit": entry["last_unit"],
                "best_lifted_weight_kg": round(best_kg, 2),
                "best_lifted_weight_lbs": round(best_lbs, 2) if best_lbs else 0,
                "total_sets": entry["total_sets"],
                "total_reps": entry["total_reps"],
                "improvement_kg": improvement,
                "history": history,
            }
        )

    return sorted(response, key=lambda x: x["exercise_name"].lower())


# --------------------- Page Routes ---------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/dashboard")
def dashboard_page():
    return render_template("dashboard.html")


@app.route("/workout")
def workout_day_selection_page():
    return render_template("workout_day.html")


@app.route("/workout/new/<workout_type>")
def workout_page(workout_type):
    workout_type = normalize(workout_type)
    if workout_type not in WORKOUT_TYPES:
        workout_type = "custom"
    return render_template("workout.html", workout_type=workout_type)


@app.route("/exercises")
def exercises_page():
    return render_template("exercises.html")


@app.route("/history")
def history_page():
    return render_template("history.html")


@app.route("/progress")
def progress_page():
    return render_template("progress.html")


# --------------------- API Routes ---------------------
@app.route("/api/muscle-groups", methods=["GET"])
def get_muscle_groups():
    data = read_json(MUSCLE_GROUPS_FILE, {})
    return jsonify(data)


@app.route("/api/map-exercise", methods=["POST"])
def map_exercise():
    payload = request.get_json(force=True)
    name = payload.get("name", "")
    return jsonify(map_exercise_by_name(name))


@app.route("/api/convert-weight", methods=["POST"])
def convert_weight_api():
    payload = request.get_json(force=True)
    converted = convert_weight(payload.get("weight"), payload.get("from_unit"), payload.get("to_unit"))
    return jsonify({"converted_weight": converted})


@app.route("/api/exercises", methods=["GET"])
def list_exercises():
    exercises = read_json(EXERCISES_FILE, [])
    workout_type = normalize(request.args.get("workout_type"))

    if workout_type:
        exercises = [e for e in exercises if normalize(e.get("workout_type")) == workout_type]

    return jsonify(exercises)


@app.route("/api/exercises", methods=["POST"])
def add_exercise():
    exercises = read_json(EXERCISES_FILE, [])
    payload = request.get_json(force=True)

    exercise = {
        "id": str(uuid.uuid4()),
        "name": payload.get("name", "").strip(),
        "workout_type": normalize(payload.get("workout_type")) or "custom",
        "primary_muscle_group": payload.get("primary_muscle_group", "").strip(),
        "secondary_muscle_groups": payload.get("secondary_muscle_groups", []),
        "equipment": payload.get("equipment", "").strip(),
        "default_sets": int(payload.get("default_sets", 3) or 3),
        "default_reps": int(payload.get("default_reps", 10) or 10),
    }

    exercises.append(exercise)
    write_json(EXERCISES_FILE, exercises)
    return jsonify(exercise), 201


@app.route("/api/exercises/<exercise_id>", methods=["PUT"])
def update_exercise(exercise_id):
    exercises = read_json(EXERCISES_FILE, [])
    payload = request.get_json(force=True)

    for exercise in exercises:
        if exercise["id"] == exercise_id:
            exercise["name"] = payload.get("name", exercise["name"]).strip()
            exercise["workout_type"] = normalize(payload.get("workout_type", exercise["workout_type"]))
            exercise["primary_muscle_group"] = payload.get(
                "primary_muscle_group", exercise["primary_muscle_group"]
            ).strip()
            exercise["secondary_muscle_groups"] = payload.get(
                "secondary_muscle_groups", exercise["secondary_muscle_groups"]
            )
            exercise["equipment"] = payload.get("equipment", exercise["equipment"]).strip()
            exercise["default_sets"] = int(payload.get("default_sets", exercise["default_sets"]) or 0)
            exercise["default_reps"] = int(payload.get("default_reps", exercise["default_reps"]) or 0)
            write_json(EXERCISES_FILE, exercises)
            return jsonify(exercise)

    return jsonify({"error": "Exercise not found"}), 404


@app.route("/api/exercises/<exercise_id>", methods=["DELETE"])
def delete_exercise(exercise_id):
    exercises = read_json(EXERCISES_FILE, [])
    updated = [e for e in exercises if e["id"] != exercise_id]

    if len(updated) == len(exercises):
        return jsonify({"error": "Exercise not found"}), 404

    write_json(EXERCISES_FILE, updated)
    return jsonify({"message": "Exercise deleted"})


@app.route("/api/workout-template/<workout_type>", methods=["GET"])
def workout_template(workout_type):
    workout_type = normalize(workout_type)
    sessions = read_json(SESSIONS_FILE, [])
    exercises = read_json(EXERCISES_FILE, [])

    same_type_sessions = [s for s in sessions if normalize(s.get("workout_type")) == workout_type]
    same_type_sessions_sorted = sorted(same_type_sessions, key=lambda s: s.get("date", ""), reverse=True)
    last_session = same_type_sessions_sorted[0] if same_type_sessions_sorted else None

    exercise_library = [e for e in exercises if normalize(e.get("workout_type")) in [workout_type, "custom"]]

    return jsonify({
        "last_session": last_session,
        "exercise_library": exercise_library,
    })


@app.route("/api/workout-sessions", methods=["GET"])
def list_workout_sessions():
    sessions = read_json(SESSIONS_FILE, [])
    return jsonify(sorted(sessions, key=lambda x: x.get("date", ""), reverse=True))


@app.route("/api/workout-sessions", methods=["POST"])
def add_workout_session():
    sessions = read_json(SESSIONS_FILE, [])
    exercises_library = read_json(EXERCISES_FILE, [])
    payload = request.get_json(force=True)

    exercises = []
    for exercise in payload.get("exercises", []):
        mapped = map_exercise_by_name(exercise.get("exercise_name", ""))
        muscle_group = exercise.get("muscle_group") or mapped.get("muscle_group", "")
        sub_muscle_group = exercise.get("sub_muscle_group") or mapped.get("sub_muscle_group", "")

        exercises.append(
            {
                "entry_type": normalize(exercise.get("entry_type")) or "exercise",
                "exercise_name": exercise.get("exercise_name", "").strip(),
                "machine": exercise.get("machine", "").strip(),
                "muscle_group": muscle_group,
                "sub_muscle_group": sub_muscle_group,
                "weight": float(exercise.get("weight", 0) or 0),
                "weight_unit": normalize(exercise.get("weight_unit")) or "kg",
                "sets": int(exercise.get("sets", 0) or 0),
                "reps": int(exercise.get("reps", 0) or 0),
                "cardio_mode": exercise.get("cardio_mode", "").strip(),
                "duration_minutes": int(exercise.get("duration_minutes", 0) or 0),
                "incline": float(exercise.get("incline", 0) or 0),
                "notes": exercise.get("notes", "").strip(),
                "completed": bool(exercise.get("completed", False)),
            }
        )

    session = {
        "id": str(uuid.uuid4()),
        "date": payload.get("date") or datetime.now().isoformat(timespec="minutes"),
        "workout_type": normalize(payload.get("workout_type")) or "custom",
        "session_notes": payload.get("session_notes", "").strip(),
        "exercises": exercises,
    }

    sessions.append(session)
    write_json(SESSIONS_FILE, sessions)

    analysis = analyze_post_workout(session, sessions, exercises_library)

    return jsonify({"session": session, "analysis": analysis}), 201


@app.route("/api/workout-sessions/<session_id>", methods=["PUT"])
def update_workout_session(session_id):
    sessions = read_json(SESSIONS_FILE, [])
    payload = request.get_json(force=True)

    for session in sessions:
        if session["id"] == session_id:
            session["workout_type"] = normalize(payload.get("workout_type", session["workout_type"]))
            session["date"] = payload.get("date", session["date"])
            session["session_notes"] = payload.get("session_notes", session.get("session_notes", ""))
            session["exercises"] = payload.get("exercises", session["exercises"])
            write_json(SESSIONS_FILE, sessions)
            return jsonify(session)

    return jsonify({"error": "Session not found"}), 404


@app.route("/api/workout-sessions/<session_id>", methods=["DELETE"])
def delete_workout_session(session_id):
    sessions = read_json(SESSIONS_FILE, [])
    updated = [s for s in sessions if s["id"] != session_id]

    if len(updated) == len(sessions):
        return jsonify({"error": "Session not found"}), 404

    write_json(SESSIONS_FILE, updated)
    return jsonify({"message": "Workout session deleted"})


@app.route("/api/history", methods=["GET"])
def workout_history():
    sessions = read_json(SESSIONS_FILE, [])

    workout_type = normalize(request.args.get("workout_type"))
    muscle_group = normalize(request.args.get("muscle_group"))
    exercise_name = normalize(request.args.get("exercise_name"))
    start_date = request.args.get("start_date")
    end_date = request.args.get("end_date")

    filtered = []
    for session in sessions:
        if workout_type and normalize(session.get("workout_type")) != workout_type:
            continue

        if start_date and session.get("date", "")[:10] < start_date:
            continue
        if end_date and session.get("date", "")[:10] > end_date:
            continue

        exercises = session.get("exercises", [])

        if muscle_group:
            if not any(normalize_muscle_group(ex.get("muscle_group")) == muscle_group for ex in exercises):
                continue

        if exercise_name:
            if not any(exercise_name in normalize(ex.get("exercise_name")) for ex in exercises):
                continue

        filtered.append(session)

    filtered_sorted = sorted(filtered, key=lambda x: x.get("date", ""), reverse=True)
    return jsonify(filtered_sorted)


@app.route("/api/dashboard", methods=["GET"])
def dashboard_data():
    sessions = read_json(SESSIONS_FILE, [])
    return jsonify(get_dashboard_data(sessions))


@app.route("/api/progress", methods=["GET"])
def progress_data():
    sessions = read_json(SESSIONS_FILE, [])
    return jsonify(get_progress_data(sessions))


if __name__ == "__main__":
    ensure_json_file(EXERCISES_FILE, [])
    ensure_json_file(SESSIONS_FILE, [])
    ensure_json_file(MUSCLE_GROUPS_FILE, {})
    app.run(debug=True)
