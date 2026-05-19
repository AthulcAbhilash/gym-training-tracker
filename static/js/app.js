const api = {
  get: async (url) => (await fetch(url)).json(),
  send: async (url, method, body) =>
    (
      await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      })
    ).json()
};

const friendlyDate = (value) => (value ? new Date(value).toLocaleString() : "-");

const todayLocalDateTime = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
};

const emptyState = (el, msg) => {
  el.innerHTML = `<div class="list-item"><p class="muted">${msg}</p></div>`;
};

let muscleGroupsCache = null;

function titleCase(text) {
  return (text || "")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function getPrimaryGroupsForWorkoutType(workoutType) {
  if (!muscleGroupsCache) return [];

  const typeMap = muscleGroupsCache[workoutType] || {};
  const groups = Object.keys(typeMap).map((k) => k.toLowerCase());

  // For custom days, allow all groups as manual fallback.
  if (workoutType === "custom") {
    const all = [];
    Object.values(muscleGroupsCache).forEach((v) => {
      Object.keys(v || {}).forEach((k) => all.push(k.toLowerCase()));
    });
    return [...new Set(all)].sort();
  }

  return groups.sort();
}

function getSubGroupsForPrimary(primaryGroup) {
  if (!muscleGroupsCache || !primaryGroup) return [];
  const normalized = primaryGroup.toLowerCase();

  for (const section of Object.values(muscleGroupsCache)) {
    for (const [primary, subs] of Object.entries(section || {})) {
      if (primary.toLowerCase() === normalized) {
        return (subs || []).map((s) => s.toLowerCase());
      }
    }
  }
  return [];
}

function renderSelectOptions(items, selectedValue, placeholder) {
  const placeholderOption = `<option value="">${placeholder}</option>`;
  const options = items
    .map((item) => {
      const val = String(item).toLowerCase();
      const selected = val === String(selectedValue || "").toLowerCase() ? "selected" : "";
      return `<option value="${val}" ${selected}>${titleCase(val)}</option>`;
    })
    .join("");
  return `${placeholderOption}${options}`;
}

async function initDashboard() {
  const data = await api.get("/api/dashboard");

  const stats = [
    ["Total Workouts", data.total_workouts],
    ["Total Exercises Logged", data.total_exercises],
    ["Most Trained Group", data.most_trained],
    ["Least Trained Group", data.least_trained]
  ];

  document.getElementById("dashboardStats").innerHTML = stats
    .map(([k, v]) => `<article class="stat"><h3>${k}</h3><p>${v}</p></article>`)
    .join("");

  document.getElementById("coverageCards").innerHTML = ["push", "pull", "legs", "core", "custom"]
    .map((type) => `<div class="stat"><h3>${type.toUpperCase()}</h3><p>${data.coverage?.[type] || 0}</p></div>`)
    .join("");

  const recent = document.getElementById("recentSessions");
  if (!data.recent_sessions?.length) {
    emptyState(recent, "No sessions yet. Start by logging your first workout.");
  } else {
    recent.innerHTML = data.recent_sessions
      .map(
        (s) =>
          `<div class="list-item"><strong>${s.workout_type.toUpperCase()}</strong><p class="muted">${friendlyDate(
            s.date
          )}</p><p>${(s.exercises || []).length} exercises</p></div>`
      )
      .join("");
  }

  new Chart(document.getElementById("weeklyChart"), {
    type: "bar",
    data: {
      labels: (data.weekly_summary || []).map((x) => x.week),
      datasets: [
        {
          label: "Workouts",
          data: (data.weekly_summary || []).map((x) => x.count),
          backgroundColor: "rgba(217,173,38,.7)",
          borderColor: "rgba(217,173,38,1)",
          borderWidth: 1
        }
      ]
    },
    options: {
      plugins: { legend: { labels: { color: "#f4f1e8" } } },
      scales: {
        x: { ticks: { color: "#f4f1e8" } },
        y: { ticks: { color: "#f4f1e8" }, beginAtZero: true }
      }
    }
  });
}

function exerciseRowTemplate(v = {}, entryType = "exercise") {
  const isCardio = entryType === "cardio" || v.entry_type === "cardio";
  if (isCardio) {
    return `
  <div class="exercise-row is-cardio">
    <input type="hidden" class="entry-type" value="cardio">
    <div class="grid two-col">
      <label>Cardio Name
        <input type="text" class="exercise-name" value="${v.exercise_name || ""}" placeholder="e.g. Treadmill Walking" required>
      </label>
      <label>Machine / Equipment
        <input type="text" class="machine" value="${v.machine || ""}" placeholder="e.g. Treadmill, Cycle, Row Machine">
      </label>
      <label>Cardio Type
        <select class="cardio-mode">
          <option value="treadmill" ${v.cardio_mode === "treadmill" ? "selected" : ""}>Treadmill Walking/Running</option>
          <option value="cycling" ${v.cardio_mode === "cycling" ? "selected" : ""}>Cycling</option>
          <option value="elliptical" ${v.cardio_mode === "elliptical" ? "selected" : ""}>Elliptical</option>
          <option value="stairmaster" ${v.cardio_mode === "stairmaster" ? "selected" : ""}>StairMaster</option>
          <option value="other" ${v.cardio_mode === "other" ? "selected" : ""}>Other</option>
        </select>
      </label>
      <label>Duration (minutes)
        <input type="number" class="duration-minutes" min="0" value="${v.duration_minutes || 0}">
      </label>
      <label>Incline (only if applicable)
        <input type="number" class="incline" step="0.5" min="0" value="${v.incline || 0}">
      </label>
      <label>Notes
        <input type="text" class="notes" value="${v.notes || ""}">
      </label>
      <label>Completed
        <select class="completed">
          <option value="true" ${v.completed !== false ? "selected" : ""}>Yes</option>
          <option value="false" ${v.completed === false ? "selected" : ""}>No</option>
        </select>
      </label>
    </div>
    <div class="action-row">
      <button type="button" class="btn remove-exercise-btn">Remove</button>
    </div>
  </div>`;
  }

  const workoutType = document.getElementById("workoutForm")?.dataset?.workoutType || "custom";
  const primaryGroups = getPrimaryGroupsForWorkoutType(workoutType);
  const selectedPrimary = (v.muscle_group || "").toLowerCase();
  const subGroups = getSubGroupsForPrimary(selectedPrimary);

  return `
  <div class="exercise-row">
    <input type="hidden" class="entry-type" value="exercise">
    <div class="grid two-col">
      <label>Exercise Name
        <input type="text" class="exercise-name" value="${v.exercise_name || ""}" placeholder="${
    "e.g. Bench Press"
  }" required>
      </label>
      <label>Machine / Equipment
        <input type="text" class="machine" value="${v.machine || ""}" placeholder="e.g. Treadmill, Cycle, Row Machine">
      </label>

      <label class="muscle-wrap">Muscle Group
        <select class="muscle-group">
          ${renderSelectOptions(primaryGroups, selectedPrimary, "Select muscle group")}
        </select>
      </label>
      <label class="sub-muscle-wrap">Sub Muscle Group
        <select class="sub-muscle-group">
          ${renderSelectOptions(subGroups, (v.sub_muscle_group || "").toLowerCase(), "Select sub muscle group")}
        </select>
      </label>

      <label class="weight-wrap">Weight
        <input type="number" class="weight" step="0.1" value="${v.weight || 0}">
      </label>
      <label class="unit-wrap">Weight Unit
        <select class="weight-unit">
          <option value="kg" ${v.weight_unit === "lbs" ? "" : "selected"}>kg</option>
          <option value="lbs" ${v.weight_unit === "lbs" ? "selected" : ""}>lbs</option>
        </select>
      </label>

      <label class="sets-wrap">Sets
        <input type="number" class="sets" min="0" value="${v.sets || 3}">
      </label>
      <label class="reps-wrap">Reps
        <input type="number" class="reps" min="0" value="${v.reps || 10}">
      </label>

      <label>Notes
        <input type="text" class="notes" value="${v.notes || ""}">
      </label>
      <label>Completed
        <select class="completed">
          <option value="true" ${v.completed !== false ? "selected" : ""}>Yes</option>
          <option value="false" ${v.completed === false ? "selected" : ""}>No</option>
        </select>
      </label>
    </div>
    <div class="action-row">
      <button type="button" class="btn convert-btn">Convert kg/lbs</button>
      <button type="button" class="btn remove-exercise-btn">Remove</button>
    </div>
  </div>`;
}

function parseWorkoutRows(rowsContainer) {
  return [...rowsContainer.querySelectorAll(".exercise-row")]
    .map((row) => {
      const entryType = row.querySelector(".entry-type").value;
      const isCardio = entryType === "cardio";

      return {
        entry_type: entryType,
        exercise_name: row.querySelector(".exercise-name").value,
        machine: row.querySelector(".machine").value,
        muscle_group: isCardio ? "" : row.querySelector(".muscle-group").value,
        sub_muscle_group: isCardio ? "" : row.querySelector(".sub-muscle-group").value,
        weight: isCardio ? 0 : Number(row.querySelector(".weight").value || 0),
        weight_unit: isCardio ? "kg" : row.querySelector(".weight-unit").value,
        sets: isCardio ? 0 : Number(row.querySelector(".sets").value || 0),
        reps: isCardio ? 0 : Number(row.querySelector(".reps").value || 0),
        cardio_mode: isCardio ? row.querySelector(".cardio-mode").value : "",
        duration_minutes: isCardio ? Number(row.querySelector(".duration-minutes").value || 0) : 0,
        incline: isCardio ? Number(row.querySelector(".incline").value || 0) : 0,
        notes: row.querySelector(".notes").value,
        completed: row.querySelector(".completed").value === "true"
      };
    })
    .filter((x) => x.exercise_name.trim());
}

function refreshSubMuscleOptions(row) {
  const primary = row.querySelector(".muscle-group")?.value || "";
  const subSelect = row.querySelector(".sub-muscle-group");
  if (!subSelect) return;
  const previous = subSelect.value || "";
  const subGroups = getSubGroupsForPrimary(primary);
  subSelect.innerHTML = renderSelectOptions(subGroups, previous, "Select sub muscle group");
}

async function initWorkoutPage() {
  const form = document.getElementById("workoutForm");
  const rows = document.getElementById("exerciseRows");
  const workoutType = form.dataset.workoutType;

  muscleGroupsCache = await api.get("/api/muscle-groups");
  document.getElementById("sessionDate").value = todayLocalDateTime();
  const tpl = await api.get(`/api/workout-template/${workoutType}`);

  if (tpl.last_session?.exercises?.length) {
    rows.innerHTML = tpl.last_session.exercises
      .map((e) => exerciseRowTemplate(e, e.entry_type || "exercise"))
      .join("");
  } else if (tpl.exercise_library?.length) {
    rows.innerHTML = tpl.exercise_library
      .map((e) =>
        exerciseRowTemplate(
          {
            exercise_name: e.name,
            machine: e.equipment,
            muscle_group: e.primary_muscle_group,
            sets: e.default_sets,
            reps: e.default_reps,
            completed: true,
            weight_unit: "kg"
          },
          "exercise"
        )
      )
      .join("");
  } else {
    rows.innerHTML = exerciseRowTemplate();
  }

  document.getElementById("addExerciseBtn").onclick = () => {
    rows.insertAdjacentHTML("beforeend", exerciseRowTemplate({}, "exercise"));
  };

  document.getElementById("addCardioBtn").onclick = () => {
    rows.insertAdjacentHTML("beforeend", exerciseRowTemplate({ cardio_mode: "treadmill", duration_minutes: 20 }, "cardio"));
  };

  rows.addEventListener("click", async (e) => {
    const row = e.target.closest(".exercise-row");
    if (!row) return;

    if (e.target.classList.contains("remove-exercise-btn")) {
      row.remove();
      if (!rows.children.length) rows.innerHTML = exerciseRowTemplate();
    }

    if (e.target.classList.contains("convert-btn")) {
      const weightInput = row.querySelector(".weight");
      const unitInput = row.querySelector(".weight-unit");
      const to = unitInput.value === "kg" ? "lbs" : "kg";
      const out = await api.send("/api/convert-weight", "POST", {
        weight: Number(weightInput.value || 0),
        from_unit: unitInput.value,
        to_unit: to
      });
      if (out.converted_weight != null) {
        weightInput.value = out.converted_weight;
        unitInput.value = to;
      }
    }
  });

  rows.addEventListener("change", (e) => {
    if (!e.target.classList.contains("muscle-group")) return;
    const row = e.target.closest(".exercise-row");
    refreshSubMuscleOptions(row);
  });

  rows.addEventListener("focusout", async (e) => {
    if (!e.target.classList.contains("exercise-name")) return;
    const row = e.target.closest(".exercise-row");
    if (row.querySelector(".entry-type")?.value === "cardio") return;

    const name = e.target.value.trim();
    if (!name) return;

    const mapped = await api.send("/api/map-exercise", "POST", { name });
    if (mapped.matched) {
      if (!row.querySelector(".muscle-group").value) {
        row.querySelector(".muscle-group").value = (mapped.muscle_group || "").toLowerCase();
        refreshSubMuscleOptions(row);
      }
      if (!row.querySelector(".sub-muscle-group").value) {
        row.querySelector(".sub-muscle-group").value = (mapped.sub_muscle_group || "").toLowerCase();
      }
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const payload = {
      date: document.getElementById("sessionDate").value,
      workout_type: workoutType,
      session_notes: document.getElementById("sessionNotes").value,
      exercises: parseWorkoutRows(rows)
    };

    const res = await api.send("/api/workout-sessions", "POST", payload);
    const analysis = res.analysis || {};

    document.getElementById("analysisCard").classList.remove("hidden");
    document.getElementById("analysisInsights").innerHTML = (analysis.insights || ["Workout saved."])
      .map((x) => `<li class="list-item">${x}</li>`)
      .join("");

    document.getElementById("underTrained").innerHTML = (analysis.under_trained || []).length
      ? analysis.under_trained.map((x) => `<span class="chip">${x}</span>`).join("")
      : `<span class="chip">No under-trained groups detected</span>`;

    document.getElementById("overTrained").innerHTML = (analysis.over_trained || []).length
      ? analysis.over_trained.map((x) => `<span class="chip">${x}</span>`).join("")
      : `<span class="chip">No over-trained groups detected</span>`;

    document.getElementById("optionalRecommendations").innerHTML = (analysis.optional_recommendations || []).length
      ? analysis.optional_recommendations
          .map((x) => `<li class="list-item">${x.name} (${x.primary_muscle_group})</li>`)
          .join("")
      : `<li class="list-item">No recommendations right now.</li>`;

    form.reset();
    document.getElementById("sessionDate").value = todayLocalDateTime();
    rows.innerHTML = exerciseRowTemplate();
  });
}

async function loadExercises() {
  const list = document.getElementById("exerciseList");
  const data = await api.get("/api/exercises");

  if (!data.length) {
    emptyState(list, "No exercises yet. Add your first exercise.");
    return;
  }

  list.innerHTML = data
    .map(
      (ex) =>
        `<div class="list-item" data-id="${ex.id}"><strong>${ex.name}</strong><p class="muted">${ex.workout_type.toUpperCase()} ù ${
          ex.primary_muscle_group
        }</p><p>${ex.equipment || "No equipment"} ù ${ex.default_sets} sets x ${ex.default_reps} reps</p><div class="action-row"><button class="btn edit-exercise-btn">Edit</button><button class="btn delete-exercise-btn">Delete</button></div></div>`
    )
    .join("");
}

function resetExerciseForm() {
  document.getElementById("exerciseId").value = "";
  document.getElementById("exerciseForm").reset();
  document.getElementById("defaultSets").value = 3;
  document.getElementById("defaultReps").value = 10;
}

async function initExercisesPage() {
  const form = document.getElementById("exerciseForm");
  const list = document.getElementById("exerciseList");

  await loadExercises();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const id = document.getElementById("exerciseId").value;
    const payload = {
      name: exerciseName.value,
      workout_type: exerciseWorkoutType.value,
      primary_muscle_group: primaryMuscle.value,
      secondary_muscle_groups: secondaryMuscles.value
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      equipment: equipment.value,
      default_sets: Number(defaultSets.value || 3),
      default_reps: Number(defaultReps.value || 10)
    };

    if (id) await api.send(`/api/exercises/${id}`, "PUT", payload);
    else await api.send("/api/exercises", "POST", payload);

    resetExerciseForm();
    await loadExercises();
  });

  resetExerciseBtn.onclick = resetExerciseForm;

  list.addEventListener("click", async (e) => {
    const card = e.target.closest(".list-item");
    if (!card) return;
    const id = card.dataset.id;

    if (e.target.classList.contains("delete-exercise-btn")) {
      await api.send(`/api/exercises/${id}`, "DELETE", {});
      await loadExercises();
    }

    if (e.target.classList.contains("edit-exercise-btn")) {
      const all = await api.get("/api/exercises");
      const ex = all.find((x) => x.id === id);
      if (!ex) return;
      exerciseId.value = ex.id;
      exerciseName.value = ex.name;
      exerciseWorkoutType.value = ex.workout_type;
      primaryMuscle.value = ex.primary_muscle_group;
      secondaryMuscles.value = (ex.secondary_muscle_groups || []).join(", ");
      equipment.value = ex.equipment;
      defaultSets.value = ex.default_sets;
      defaultReps.value = ex.default_reps;
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
}

async function renderHistory() {
  const p = new URLSearchParams({
    workout_type: filterWorkoutType.value,
    muscle_group: filterMuscleGroup.value,
    exercise_name: filterExerciseName.value,
    start_date: filterStartDate.value,
    end_date: filterEndDate.value
  });

  const data = await api.get(`/api/history?${p.toString()}`);
  const list = document.getElementById("historyList");

  if (!data.length) {
    emptyState(list, "No history found for selected filters.");
    return;
  }

  list.innerHTML = data
    .map(
      (s) => `<div class="list-item"><strong>${s.workout_type.toUpperCase()} | ${friendlyDate(s.date)}</strong><p>${
        s.session_notes || "No session note"
      }</p><ul>${(s.exercises || [])
        .map((ex) => {
          if (ex.entry_type === "cardio") {
            return `<li>${ex.exercise_name} - ${ex.duration_minutes || 0} min (${ex.cardio_mode || "cardio"})${
              ex.incline ? `, incline ${ex.incline}` : ""
            }</li>`;
          }
          return `<li>${ex.exercise_name} - ${ex.weight}${ex.weight_unit}, ${ex.sets}x${ex.reps} (${ex.muscle_group || "manual"})</li>`;
        })
        .join("")}</ul><div class="action-row"><button class="btn edit-session-btn" data-id="${s.id}">Edit Workout</button><button class="btn delete-session-btn" data-id="${s.id}">Delete Workout</button></div></div>`
    )
    .join("");
}

function sessionExerciseEditorRow(ex) {
  if (ex.entry_type === "cardio") {
    return `<div class="exercise-row is-cardio">
      <input type="hidden" class="entry-type" value="cardio">
      <div class="grid two-col">
        <label>Cardio Name<input type="text" class="exercise-name" value="${ex.exercise_name || ""}"></label>
        <label>Machine<input type="text" class="machine" value="${ex.machine || ""}"></label>
        <label>Cardio Type
          <select class="cardio-mode">
            <option value="treadmill" ${ex.cardio_mode === "treadmill" ? "selected" : ""}>Treadmill</option>
            <option value="cycling" ${ex.cardio_mode === "cycling" ? "selected" : ""}>Cycling</option>
            <option value="elliptical" ${ex.cardio_mode === "elliptical" ? "selected" : ""}>Elliptical</option>
            <option value="stairmaster" ${ex.cardio_mode === "stairmaster" ? "selected" : ""}>StairMaster</option>
            <option value="other" ${ex.cardio_mode === "other" ? "selected" : ""}>Other</option>
          </select>
        </label>
        <label>Duration (minutes)<input type="number" class="duration-minutes" min="0" value="${ex.duration_minutes || 0}"></label>
        <label>Incline<input type="number" class="incline" step="0.5" min="0" value="${ex.incline || 0}"></label>
        <label>Notes<input type="text" class="notes" value="${ex.notes || ""}"></label>
        <label>Completed
          <select class="completed">
            <option value="true" ${ex.completed !== false ? "selected" : ""}>Yes</option>
            <option value="false" ${ex.completed === false ? "selected" : ""}>No</option>
          </select>
        </label>
      </div>
    </div>`;
  }

  return `<div class="exercise-row">
      <input type="hidden" class="entry-type" value="exercise">
      <div class="grid two-col">
        <label>Exercise Name<input type="text" class="exercise-name" value="${ex.exercise_name || ""}"></label>
        <label>Machine<input type="text" class="machine" value="${ex.machine || ""}"></label>
        <label>Muscle Group<input type="text" class="muscle-group" value="${ex.muscle_group || ""}"></label>
        <label>Sub Muscle Group<input type="text" class="sub-muscle-group" value="${ex.sub_muscle_group || ""}"></label>
        <label>Weight<input type="number" class="weight" step="0.1" value="${ex.weight || 0}"></label>
        <label>Weight Unit
          <select class="weight-unit">
            <option value="kg" ${ex.weight_unit === "lbs" ? "" : "selected"}>kg</option>
            <option value="lbs" ${ex.weight_unit === "lbs" ? "selected" : ""}>lbs</option>
          </select>
        </label>
        <label>Sets<input type="number" class="sets" min="0" value="${ex.sets || 0}"></label>
        <label>Reps<input type="number" class="reps" min="0" value="${ex.reps || 0}"></label>
        <label>Notes<input type="text" class="notes" value="${ex.notes || ""}"></label>
        <label>Completed
          <select class="completed">
            <option value="true" ${ex.completed !== false ? "selected" : ""}>Yes</option>
            <option value="false" ${ex.completed === false ? "selected" : ""}>No</option>
          </select>
        </label>
      </div>
    </div>`;
}

function parseSessionEditorRows(container) {
  return [...container.querySelectorAll(".exercise-row")]
    .map((row) => {
      const entryType = row.querySelector(".entry-type").value;
      if (entryType === "cardio") {
        return {
          entry_type: "cardio",
          exercise_name: row.querySelector(".exercise-name").value,
          machine: row.querySelector(".machine").value,
          muscle_group: "",
          sub_muscle_group: "",
          weight: 0,
          weight_unit: "kg",
          sets: 0,
          reps: 0,
          cardio_mode: row.querySelector(".cardio-mode").value,
          duration_minutes: Number(row.querySelector(".duration-minutes").value || 0),
          incline: Number(row.querySelector(".incline").value || 0),
          notes: row.querySelector(".notes").value,
          completed: row.querySelector(".completed").value === "true"
        };
      }
      return {
        entry_type: "exercise",
        exercise_name: row.querySelector(".exercise-name").value,
        machine: row.querySelector(".machine").value,
        muscle_group: row.querySelector(".muscle-group").value,
        sub_muscle_group: row.querySelector(".sub-muscle-group").value,
        weight: Number(row.querySelector(".weight").value || 0),
        weight_unit: row.querySelector(".weight-unit").value,
        sets: Number(row.querySelector(".sets").value || 0),
        reps: Number(row.querySelector(".reps").value || 0),
        cardio_mode: "",
        duration_minutes: 0,
        incline: 0,
        notes: row.querySelector(".notes").value,
        completed: row.querySelector(".completed").value === "true"
      };
    })
    .filter((x) => x.exercise_name.trim());
}

async function initHistoryPage() {
  await renderHistory();

  historyFilters.addEventListener("submit", async (e) => {
    e.preventDefault();
    await renderHistory();
  });

  clearFiltersBtn.onclick = async () => {
    historyFilters.reset();
    await renderHistory();
  };

  historyList.addEventListener("click", async (e) => {
    if (e.target.classList.contains("edit-session-btn")) {
      const id = e.target.dataset.id;
      const sessions = await api.get("/api/workout-sessions");
      const session = sessions.find((x) => x.id === id);
      if (!session) return;

      const editorHtml = `<div class="card" id="sessionEditorCard">
        <h3>Edit Workout Session</h3>
        <div class="grid two-col">
          <label>Date and Time<input type="datetime-local" id="editSessionDate" value="${(session.date || "").slice(0, 16)}"></label>
          <label>Workout Type
            <select id="editSessionType">
              <option value="push" ${session.workout_type === "push" ? "selected" : ""}>Push</option>
              <option value="pull" ${session.workout_type === "pull" ? "selected" : ""}>Pull</option>
              <option value="legs" ${session.workout_type === "legs" ? "selected" : ""}>Legs</option>
              <option value="core" ${session.workout_type === "core" ? "selected" : ""}>Core</option>
              <option value="custom" ${session.workout_type === "custom" ? "selected" : ""}>Custom</option>
            </select>
          </label>
        </div>
        <label>Session Notes<input type="text" id="editSessionNotes" value="${session.session_notes || ""}"></label>
        <div class="section-head">
          <h4>Exercises</h4>
          <div class="action-row compact">
            <button class="btn" id="editAddExerciseBtn" type="button">Add Exercise</button>
            <button class="btn" id="editAddCardioBtn" type="button">Add Cardio</button>
          </div>
        </div>
        <div id="sessionEditorRows" class="exercise-rows">${(session.exercises || []).map(sessionExerciseEditorRow).join("")}</div>
        <div class="action-row">
          <button class="btn primary" id="saveSessionEditBtn">Save Changes</button>
          <button class="btn" id="cancelSessionEditBtn">Cancel</button>
        </div>
      </div>`;

      const existing = document.getElementById("sessionEditorCard");
      if (existing) existing.remove();
      historyList.insertAdjacentHTML("afterbegin", editorHtml);
      document.getElementById("sessionEditorCard").scrollIntoView({ behavior: "smooth", block: "start" });

      document.getElementById("cancelSessionEditBtn").onclick = () => {
        const card = document.getElementById("sessionEditorCard");
        if (card) card.remove();
      };

      document.getElementById("editAddExerciseBtn").onclick = () => {
        document
          .getElementById("sessionEditorRows")
          .insertAdjacentHTML("beforeend", sessionExerciseEditorRow({ entry_type: "exercise", completed: true, weight_unit: "kg" }));
      };

      document.getElementById("editAddCardioBtn").onclick = () => {
        document
          .getElementById("sessionEditorRows")
          .insertAdjacentHTML(
            "beforeend",
            sessionExerciseEditorRow({ entry_type: "cardio", cardio_mode: "treadmill", duration_minutes: 20, completed: true })
          );
      };

      document.getElementById("saveSessionEditBtn").onclick = async () => {
        const payload = {
          date: document.getElementById("editSessionDate").value,
          workout_type: document.getElementById("editSessionType").value,
          session_notes: document.getElementById("editSessionNotes").value,
          exercises: parseSessionEditorRows(document.getElementById("sessionEditorRows"))
        };
        await api.send(`/api/workout-sessions/${id}`, "PUT", payload);
        await renderHistory();
      };
      return;
    }

    if (!e.target.classList.contains("delete-session-btn")) return;
    await api.send(`/api/workout-sessions/${e.target.dataset.id}`, "DELETE", {});
    await renderHistory();
  });
}

let progressChart;

function drawProgressChart(d) {
  if (progressChart) progressChart.destroy();

  progressChart = new Chart(document.getElementById("progressChart"), {
    type: "line",
    data: {
      labels: d.history.map((x) => x.date?.slice(0, 10)),
      datasets: [
        {
          label: `${d.exercise_name} (kg)`,
          data: d.history.map((x) => x.weight_kg || 0),
          borderColor: "#d9ad26",
          backgroundColor: "rgba(217,173,38,.2)",
          tension: 0.2,
          fill: true
        }
      ]
    },
    options: {
      plugins: { legend: { labels: { color: "#f4f1e8" } } },
      scales: {
        x: { ticks: { color: "#f4f1e8" } },
        y: { ticks: { color: "#f4f1e8" } }
      }
    }
  });
}

async function initProgressPage() {
  const data = await api.get("/api/progress");

  if (!data.length) {
    progressTable.innerHTML = `<div class="list-item"><p class="muted">No progress yet. Log workouts to view progress stats.</p></div>`;
    return;
  }

  progressTable.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Exercise</th><th>Last Lift</th><th>Best Lift (kg/lbs)</th><th>Total Sets</th><th>Total Reps</th><th>Improvement (kg)</th></tr></thead><tbody>${data
    .map(
      (r) =>
        `<tr><td>${r.exercise_name}</td><td>${r.last_lifted_weight} ${r.last_unit}</td><td>${r.best_lifted_weight_kg} / ${r.best_lifted_weight_lbs}</td><td>${r.total_sets}</td><td>${r.total_reps}</td><td>${r.improvement_kg}</td></tr>`
    )
    .join("")}</tbody></table></div>`;

  progressExerciseSelect.innerHTML = data.map((d, i) => `<option value="${i}">${d.exercise_name}</option>`).join("");
  drawProgressChart(data[0]);
  progressExerciseSelect.onchange = () => drawProgressChart(data[Number(progressExerciseSelect.value)]);
}

document.addEventListener("DOMContentLoaded", () => {
  if (typeof window.pageInit === "function") window.pageInit();
});
