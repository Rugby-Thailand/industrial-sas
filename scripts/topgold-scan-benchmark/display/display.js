const photo = document.querySelector("#photo");
const stage = document.querySelector("#stage");
const selector = document.querySelector("#specimen");
const status = document.querySelector("#status");
let specimens = [];
let current = 0;
let zoom = 1;
let pan = { x: 0, y: 0 };
let drag;

function paint() {
  photo.style.transform = `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  document.querySelector("#zoom-label").value = `${Math.round(zoom * 100)}%`;
}

function fit() {
  zoom = 1;
  pan = { x: 0, y: 0 };
  paint();
}

function changeZoom(factor) {
  zoom = Math.min(6, Math.max(0.5, zoom * factor));
  paint();
}

function showSpecimen(index) {
  current = Math.max(0, Math.min(specimens.length - 1, index));
  const specimen = specimens[current];
  selector.value = String(specimen.id);
  document.querySelector("#previous").disabled = current === 0;
  document.querySelector("#next").disabled = current === specimens.length - 1;
  document.querySelector("#metadata").textContent =
    `ตัวอย่าง #${specimen.id} · ต้นฉบับ ${specimen.width.toLocaleString()} × ${specimen.height.toLocaleString()} px · ${current + 1}/${specimens.length}`;
  photo.alt = `ภาพใบ Job ต้นฉบับ ตัวอย่าง ${specimen.id}`;
  status.hidden = false;
  status.textContent = "กำลังโหลดรูป…";
  photo.src = specimen.src;
  const url = new URL(location.href);
  url.searchParams.set("id", String(specimen.id));
  history.replaceState(null, "", url);
  fit();
}

function clean(value) {
  document.body.classList.toggle("clean", value);
  document.querySelector("#show").hidden = !value;
}

async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    status.hidden = false;
    status.textContent = "เปิดเต็มจอไม่ได้ ใช้ปุ่มเต็มจอของเบราว์เซอร์ได้ครับ";
  }
}

photo.addEventListener("load", () => {
  status.hidden = true;
});
photo.addEventListener("error", () => {
  status.hidden = false;
  status.textContent = "โหลดรูปไม่ได้ กรุณาเลือกตัวอย่างอื่น";
});
selector.addEventListener("change", () =>
  showSpecimen(
    specimens.findIndex((item) => item.id === Number(selector.value)),
  ),
);
document
  .querySelector("#previous")
  .addEventListener("click", () => showSpecimen(current - 1));
document
  .querySelector("#next")
  .addEventListener("click", () => showSpecimen(current + 1));
document
  .querySelector("#zoom-in")
  .addEventListener("click", () => changeZoom(1.25));
document
  .querySelector("#zoom-out")
  .addEventListener("click", () => changeZoom(0.8));
document.querySelector("#fit").addEventListener("click", fit);
document.querySelector("#fullscreen").addEventListener("click", fullscreen);
document.querySelector("#hide").addEventListener("click", () => clean(true));
document.querySelector("#show").addEventListener("click", () => clean(false));
stage.addEventListener("pointerdown", (event) => {
  drag = { x: event.clientX, y: event.clientY, startX: pan.x, startY: pan.y };
  stage.setPointerCapture(event.pointerId);
  stage.classList.add("dragging");
});
stage.addEventListener("pointermove", (event) => {
  if (!drag) return;
  pan = {
    x: drag.startX + event.clientX - drag.x,
    y: drag.startY + event.clientY - drag.y,
  };
  paint();
});
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
  stage.addEventListener(name, () => {
    drag = undefined;
    stage.classList.remove("dragging");
  });
}
document.addEventListener("keydown", (event) => {
  if (
    event.target instanceof HTMLSelectElement ||
    !specimens.length ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  )
    return;
  const actions = {
    ArrowLeft: () => showSpecimen(current - 1),
    ArrowRight: () => showSpecimen(current + 1),
    "+": () => changeZoom(1.25),
    "=": () => changeZoom(1.25),
    "-": () => changeZoom(0.8),
    0: fit,
    f: fullscreen,
    h: () => clean(!document.body.classList.contains("clean")),
  };
  const action = actions[event.key.toLowerCase()] ?? actions[event.key];
  if (action) {
    event.preventDefault();
    action();
  }
});

try {
  const response = await fetch("/api/specimens");
  if (!response.ok) throw new Error("Catalog unavailable");
  specimens = await response.json();
  selector.replaceChildren();
  for (const specimen of specimens) {
    const option = document.createElement("option");
    option.value = String(specimen.id);
    option.textContent = `#${specimen.id}${specimen.recommended ? " · ชุดเริ่มทดลอง" : ""}`;
    selector.append(option);
  }
  selector.disabled = false;
  const requested = Number(new URL(location.href).searchParams.get("id") ?? 50);
  showSpecimen(
    Math.max(
      0,
      specimens.findIndex((item) => item.id === requested),
    ),
  );
} catch {
  status.textContent = "เปิดชุดภาพไม่ได้ กรุณาตรวจว่าโฟลเดอร์รูปต้นฉบับยังอยู่";
}
