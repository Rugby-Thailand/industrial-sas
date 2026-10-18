/* Standalone, session-local preview. No provider/API requests or production writes. */
(() => {
  "use strict";
  const KEY = "industrial-line-hr-preview-v1";
  const $ = (selector) => document.querySelector(selector);
  const escape = (value = "") =>
    String(value).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const paths = {
    settings:
      '<path d="m9 4 1-2h4l1 2 2 1 2-.5 2 3-1 2v3l1 2-2 3-2-.5-2 1-1 2h-4l-1-2-2-1-2 .5-2-3 1-2v-3l-1-2 2-3 2 .5Z"/><circle cx="12" cy="12" r="3"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/>',
    bot: '<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 7V3M9 3h6M8 13h.01M16 13h.01M9 17h6M1 11v5M23 11v5"/>',
    card: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 13h7M7 16h10"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z M22 2 11 13"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    users:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.9M16 3a4 4 0 0 1 0 8"/><circle cx="9" cy="7" r="4"/>',
    chat: '<path d="M21 11.5a9 9 0 0 1-13.5 7.8L3 21l1.7-4.5A9 9 0 1 1 21 11.5Z"/>',
    chart: '<path d="M4 3v17h17M8 15v-4M13 15V7M18 15v-7"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    down: '<path d="M12 4v16m-6-6 6 6 6-6"/>',
    flow: '<rect x="3" y="3" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M6 8v10h9M9 5h9v11"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M19 5l-1 1M6 18l-1 1"/>',
    moon: '<path d="M20.5 13a9 9 0 0 1-9.5-9.5A9 9 0 1 0 20.5 13Z"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  };
  const icon = (name) =>
    `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.card}</svg>`;
  const btn = (label, action, extra = "", style = "") =>
    `<button type="button" class="button ${style}" data-action="${action}" ${extra}>${label}</button>`;
  const link = (label, route, style = "", name = "") =>
    `<a href="#/${route}" data-route="${route}" class="button ${style}">${name ? icon(name) : ""}${label}</a>`;
  const badge = (label, kind = "") =>
    `<span class="status ${kind}">${escape(label)}</span>`;
  const notice = (text, kind = "") =>
    `<div class="notice ${kind}">${text}</div>`;
  const bots = { standard: "ผู้ช่วย HR", shift: "ผู้ช่วยงานกะ" };
  function seed(scenario = "ready") {
    const ready = scenario !== "fresh";
    return {
      version: 1,
      scenario,
      role: "hr",
      selectedEmployee: "e2",
      theme: "light",
      connection: {
        name: "SiamPack HR",
        channel: "2001234567",
        credentials: ready,
        webhook: ready,
        tested: ready,
        active: ready,
        outage: scenario === "outage",
      },
      bot: {
        default: "standard",
        welcome:
          "สวัสดีคุณ {{employeeName}} ฉันช่วยดูตารางงานและติดตามเรื่อง HR ของคุณได้",
        correction: true,
        clock: false,
        holiday: true,
        quietStart: "21:00",
        quietEnd: "07:00",
      },
      employees: [
        {
          id: "e1",
          code: "EMP-001",
          name: "พิมพ์ชนก วงศ์สุวรรณ",
          short: "พิมพ์ชนก",
          site: "โรงงานบางนา",
          job: "ฝ่ายผลิต",
          account: true,
          line: "connected",
          lineName: "Pimchanok",
          active: true,
          bot: "default",
          notifications: true,
        },
        {
          id: "e2",
          code: "EMP-002",
          name: "ธนกร ศรีสมบัติ",
          short: "ธนกร",
          site: "โรงงานบางนา",
          job: "คลังสินค้า",
          account: true,
          line: "unlinked",
          lineName: "Thanakorn",
          active: true,
          bot: "default",
          notifications: true,
        },
        {
          id: "e3",
          code: "EMP-003",
          name: "กมลวรรณ ใจดี",
          short: "กมลวรรณ",
          site: "โรงงานบางนา",
          job: "ฝ่ายตรวจคุณภาพ",
          account: true,
          line: "blocked",
          lineName: "Kamolwan",
          active: true,
          bot: "shift",
          notifications: true,
        },
        {
          id: "e4",
          code: "EMP-004",
          name: "ณัฐพงษ์ แสงทอง",
          short: "ณัฐพงษ์",
          site: "โรงงานบางนา",
          job: "ฝ่ายผลิต",
          account: false,
          line: "unlinked",
          lineName: "Nattapong",
          active: true,
          bot: "default",
          notifications: true,
        },
      ],
      templates: [
        {
          id: "meeting",
          name: "ประกาศทีมและขอรับทราบ",
          kind: "ประกาศทีม",
          title: "ประชุมทีมประจำสัปดาห์",
          body: "เรียนคุณ {{employeeName}}\nวันศุกร์ที่ 16 ต.ค. เวลา 09:00 น.\nห้องประชุมชั้น 1\n\nเราจะทบทวนแผนงานและความปลอดภัยในการทำงาน โปรดอ่านและกดรับทราบ",
          ack: true,
          label: "รับทราบ",
          version: 1,
        },
        {
          id: "correction",
          name: "ผลคำขอแก้ไขเวลา",
          kind: "ผลคำขอ HR",
          title: "คำขอแก้ไขเวลาของคุณได้รับการรับรอง",
          body: "คุณ {{employeeName}}\nคำขอแก้ไขเวลาวันที่ 12 ต.ค. ได้รับการรับรองแล้ว\n\nเปิดรายละเอียดเพื่อดูเวลาที่รับรองในระบบ HR",
          ack: false,
          label: "รับทราบ",
          version: 1,
        },
        {
          id: "clock",
          name: "เตือนลงเวลา",
          kind: "แจ้งเตือนเวลา",
          title: "อย่าลืมลงเวลาของวันนี้",
          body: "สวัสดีคุณ {{employeeName}}\nยังไม่พบการลงเวลาเข้างานวันนี้ที่ {{siteName}}\n\nหากเริ่มงานแล้ว เปิดหน้าวันนี้เพื่อตรวจสอบและลงเวลา",
          ack: false,
          label: "รับทราบ",
          version: 1,
        },
      ],
      publications: [
        {
          id: "p1",
          template: "meeting",
          version: 1,
          title: "ประชุมทีมประจำสัปดาห์",
          body: "เรียนคุณ {{employeeName}}\nวันศุกร์ที่ 16 ต.ค. เวลา 09:00 น.\nห้องประชุมชั้น 1\n\nเราจะทบทวนแผนงานและความปลอดภัยในการทำงาน โปรดอ่านและกดรับทราบ",
          kind: "ประกาศทีม",
          ack: true,
          label: "รับทราบ",
          state: "published",
          at: "13 ต.ค. 2569 · 10:00",
          schedule: "",
          recipients: [
            {
              employee: "e1",
              delivery: "accepted",
              opened: true,
              ackAt: "13 ต.ค. 2569 · 10:12",
              reminders: 0,
            },
            {
              employee: "e2",
              delivery: "unlinked",
              opened: false,
              ackAt: null,
              reminders: 0,
            },
            {
              employee: "e3",
              delivery: "blocked",
              opened: false,
              ackAt: null,
              reminders: 0,
            },
          ],
        },
      ],
      chats: {},
      threads: {},
      invitations: {},
      drafts: {},
      completed: {},
      nextId: 2,
    };
  }
  let state;
  try {
    state = JSON.parse(sessionStorage.getItem(KEY));
  } catch {
    /* isolated preview storage may be unavailable */
  }
  if (!state || state.version !== 1) state = seed();
  let busy = false,
    activeRoute = "",
    dirty = false,
    toastTimer,
    dialogAction = null,
    dialogFocus = null,
    rollback = false;
  const save = () => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* memory remains usable */
    }
  };
  const employee = (id = state.selectedEmployee) =>
    state.employees.find((e) => e.id === id) || state.employees[1];
  const template = (id) =>
    state.templates.find((t) => t.id === id) || state.templates[0];
  const publication = (id) => state.publications.find((p) => p.id === id);
  const ready = () => state.connection.active && !state.connection.outage;
  const botName = (e) => bots[e.bot === "default" ? state.bot.default : e.bot];
  const bound = (e) => e.account && e.active && e.line === "connected";
  const personalize = (text, e = employee()) =>
    String(text)
      .replace(/\{\{employeeName\}\}/g, e.short)
      .replace(/\{\{siteName\}\}/g, e.site)
      .replace(/\{\{date\}\}/g, "13 ต.ค. 2569")
      .replace(/\{\{time\}\}/g, "08:30");
  const stamp = () => "13 ต.ค. 2569 · 10:30";
  function routeData(route = location.hash.slice(2) || "connection") {
    const [page, search = ""] = route.split("?");
    return { page, params: new URLSearchParams(search), route };
  }
  function toast(text) {
    $("#toast").textContent = text;
    $("#toast").classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => $("#toast").classList.remove("visible"),
      3400,
    );
  }
  function openDialog(title, text, choices) {
    if (busy) return toast("กำลังบันทึก โปรดรอสักครู่");
    dialogFocus = document.activeElement;
    $("#dialog").innerHTML =
      `<h2 id="dialog-title">${escape(title)}</h2><p>${text}</p><div class="dialog-options">${choices.map((c, i) => btn(c.label, "dialog-choice", `data-choice="${i}"`, c.primary ? "primary" : c.danger ? "danger" : "")).join("")}</div>`;
    $("#dialog")._choices = choices;
    const index = (history.state?.previewIndex || 0) + 1;
    history.pushState(
      { previewIndex: index, modal: true, parent: activeRoute },
      "",
      location.href,
    );
    $("#dialog").showModal();
  }
  function closeDialog(action) {
    dialogAction = action || null;
    if (history.state?.modal) history.back();
    else {
      $("#dialog").close();
      if (dialogAction) {
        const fn = dialogAction;
        dialogAction = null;
        fn();
      }
    }
  }
  function navigate(route, replace = false, unchecked = false) {
    if (busy) return toast("กำลังบันทึก โปรดรอสักครู่");
    if (!unchecked && dirty && route !== activeRoute) {
      return openDialog(
        "มีการแก้ไขที่ยังไม่ได้บันทึก",
        "กลับไปทำต่อ หรือทิ้งการแก้ไขก่อนออกจากหน้านี้",
        [
          { label: "ทำต่อในหน้านี้", run: () => {} },
          {
            label: "ทิ้งการแก้ไขและออก",
            danger: true,
            run: () => {
              delete state.drafts[activeRoute];
              dirty = false;
              save();
              navigate(route, replace, true);
            },
          },
        ],
      );
    }
    const entry = {
      previewIndex: (history.state?.previewIndex || 0) + (replace ? 0 : 1),
      parent: activeRoute,
    };
    history[replace ? "replaceState" : "pushState"](entry, "", `#/${route}`);
    render(true);
  }
  function complete(destination) {
    dirty = false;
    delete state.drafts[activeRoute];
    save();
    if (history.state?.parent === destination && history.state.previewIndex > 0)
      history.back();
    else navigate(destination, true, true);
  }
  function cancel(destination) {
    if (dirty)
      return openDialog(
        "ยกเลิกการแก้ไขนี้?",
        "ข้อมูลที่บันทึกไว้เดิมจะยังอยู่ การแก้ไขรอบนี้จะถูกทิ้ง",
        [
          { label: "แก้ไขต่อ", run: () => {} },
          {
            label: "ยกเลิกการแก้ไข",
            danger: true,
            run: () => {
              delete state.drafts[activeRoute];
              complete(destination);
            },
          },
        ],
      );
    complete(destination);
  }
  async function operation(button, label, run) {
    if (busy) return;
    busy = true;
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="pending-indicator">${label}</span>`;
    await new Promise((resolve) => setTimeout(resolve, 380));
    try {
      run();
      save();
    } finally {
      busy = false;
      if (button.isConnected) {
        button.disabled = false;
        button.innerHTML = original;
      }
    }
  }
  const header = (title, subtitle, actions = "") =>
    `<div class="page-header"><div><h1>${title}</h1><p>${subtitle}</p></div>${actions ? `<div class="header-actions">${actions}</div>` : ""}</div>`;
  const back = (destination, label = "กลับ") =>
    `<a class="back" href="#/${destination}" data-action="return-page" data-parent="${destination}">${icon("back")}${label}</a>`;
  const rowStatus = (e) =>
    ({
      connected: badge("เชื่อมแล้ว", "good"),
      unlinked: badge("ยังไม่เชื่อม"),
      pending: badge("รอยืนยัน", "pending"),
      blocked: badge("LINE ถูกบล็อก", "bad"),
    })[e.line];
  const deliveryLabel = (key) =>
    ({
      accepted: "API รับคำขอแล้ว",
      unlinked: "ยังไม่เชื่อม LINE",
      blocked: "LINE ถูกบล็อก",
      failed: "ส่ง LINE ไม่ได้",
      scheduled: "รอเวลาส่ง",
      paused: "ปิดการแจ้งเตือน",
      quiet: "รอสิ้นสุดเวลาเงียบ",
    })[key] || key;
  function sidebar(page) {
    const entries =
      state.role === "employee"
        ? [
            ["employee/home", "หน้าพนักงาน", "users"],
            ["employee/chat", "LINE ผู้ช่วย HR", "chat"],
            ["employee/profile", "บัญชีและการแจ้งเตือน", "settings"],
            ["flow", "ดู flow ทั้งหมด", "flow"],
          ]
        : [
            ["connection", "การเชื่อมต่อ LINE", "link"],
            ["bot", "ผู้ช่วยและแจ้งเตือน", "bot"],
            ["cards", "แบบข้อความ Card", "card"],
            ["send", "ส่งข้อความ", "send"],
            ["tracking", "ติดตามการรับทราบ", "chart"],
            ["employees", "พนักงาน HR", "users"],
            ["inbox", "กล่องข้อความ HR", "chat"],
            ["flow", "ดู flow ทั้งหมด", "flow"],
          ];
    $("#sidebar").innerHTML =
      `<div class="brand"><span class="brand-mark">IS</span>Industrial SAS</div><nav aria-label="เมนู LINE พนักงาน">${entries.map(([route, label, glyph], i) => `${i === 0 ? '<div class="nav-group">LINE สำหรับพนักงาน</div>' : i === 5 ? '<div class="nav-group">งาน HR</div>' : ""}<a class="nav-link ${page === route || (route === "cards" && page === "cards/edit") || (route === "tracking" && page === "tracking/detail") || (route === "employees" && page === "employees/link") || (route === "employee/home" && page === "employee/message") ? "active" : ""}" href="#/${route}" data-route="${route}">${icon(glyph)}<span>${label}</span></a>`).join("")}</nav><div class="side-footer">UI จาก Drease / EasePOS<br>ปรับสำหรับงาน HR ของ Industrial SAS</div>`;
  }
  function steps() {
    const c = state.connection;
    return `<ol class="progress-steps" aria-label="ความพร้อม LINE"><li class="${c.credentials ? "done" : "current"}"><span class="step-dot">${c.credentials ? icon("check") : "1"}</span>เชื่อม OA</li><li class="${c.webhook ? "done" : c.credentials ? "current" : ""}"><span class="step-dot">${c.webhook ? icon("check") : "2"}</span>เปิดรับข้อความ</li><li class="${c.tested ? "done" : c.webhook ? "current" : ""}"><span class="step-dot">${c.tested ? icon("check") : "3"}</span>ทดสอบ / เปิดใช้</li></ol>`;
  }
  function phone(
    content,
    { compose = false, id = "phone", name = state.connection.name } = {},
  ) {
    return `<div class="phone" id="${id}"><div class="phone-screen"><div class="phone-status"><span>9:41</span><span>LTE · 100%</span></div><div class="phone-header">${icon("back")}<strong>${escape(name)}</strong><span class="oa-label">OA</span>${icon("chat")}</div><div class="line-chat"><div class="line-day"><span>วันนี้ · ตัวอย่าง</span></div>${content}</div><form class="phone-compose" data-form="chat"><input name="message" value="${escape(state.chatDrafts?.[state.selectedEmployee] || "")}" aria-label="ข้อความถึงผู้ช่วย HR" placeholder="${compose ? "ถามผู้ช่วย HR…" : "ช่องพิมพ์ข้อความ"}" ${compose ? "" : "disabled"} autocomplete="off"><button type="${compose ? "submit" : "button"}" aria-label="ส่งข้อความ" ${compose ? "" : "disabled"}>${icon("send")}</button></form></div></div>`;
  }
  function lineText(text, from = "bot") {
    return `<div class="line-row ${from === "employee" ? "user" : ""}">${from !== "employee" ? '<span class="line-avatar">SP</span>' : ""}<div class="line-stack">${from !== "employee" ? `<div class="line-who">${from === "hr" ? "พัชราภา · HR" : escape(state.connection.name)}</div>` : ""}<div class="line-text">${escape(text)}</div></div></div>`;
  }
  function flex(
    t,
    e = employee(),
    { preview = false, pubId = "", inApp = false } = {},
  ) {
    const ackAction = preview ? "preview-ack" : "ack";
    return `<div class="line-row"><span class="line-avatar">SP</span><div class="line-stack"><div class="line-who">${escape(state.connection.name)}</div><div class="flex-card"><div class="flex-body"><div class="flex-type">${escape(t.kind)}${t.ack ? " · ต้องรับทราบ" : ""}</div><div class="flex-title">${escape(personalize(t.title, e))}</div><div class="flex-copy">${escape(personalize(t.body, e))}</div><div class="flex-meta">แจ้งโดย HR · ข้อความรุ่น ${t.version}<br>${t.ack ? "โปรดกดรับทราบเมื่ออ่านแล้ว" : "เปิดรายละเอียดเพื่อดูข้อมูลในระบบ"}</div></div><div class="flex-actions">${t.ack ? `<button type="button" data-action="${ackAction}" data-id="${pubId}" data-employee="${e.id}" data-channel="${inApp ? "app" : "line"}">${escape(t.label || "รับทราบ")}</button>` : ""}<button type="button" class="detail" data-action="${preview ? "preview-detail" : "message-detail"}" data-id="${pubId}">ดูรายละเอียด</button></div></div></div></div>`;
  }
  function connectionView() {
    const c = state.connection,
      draft = state.drafts.connection || {};
    return (
      header(
        "LINE สำหรับพนักงาน",
        "ตั้งค่า OA ของธุรกิจหนึ่งครั้ง แล้วให้พนักงานเชื่อมบัญชีของตนเอง",
        link("ดูพนักงาน", "employees", "", "users"),
      ) +
      steps() +
      (c.outage
        ? `<div class="provider-state">${notice("ช่องทาง LINE ขัดข้องในสถานการณ์ตัวอย่าง ข้อความยังดูได้ในแอป เมื่อแก้การเชื่อมต่อแล้วจึงลองส่งอีกครั้ง", "error")}</div>`
        : "") +
      `<div class="split"><section><div class="section-title"><h2>บัญชี LINE Official Account</h2><p>ใช้ OA สำหรับพนักงานของธุรกิจ แยกจากช่องทางลูกค้า</p></div><form data-form="connection"><div class="fields"><div class="field wide"><label for="oa-name">ชื่อ OA ที่พนักงานจะเห็น</label><input id="oa-name" name="name" value="${escape(draft.name ?? c.name)}" required maxlength="60"></div><div class="field"><label for="channel">Channel ID</label><input id="channel" name="channel" value="${escape(draft.channel ?? c.channel)}" inputmode="numeric" required></div><div class="field"><label for="provider">LINE Provider</label><input id="provider" value="SiamPack (ตัวอย่าง)" readonly><small>Provider ของบัญชีพนักงานต้องตรงกับช่องทางนี้</small></div><div class="field wide"><label for="access-token">Channel access token</label><input id="access-token" name="token" type="password" placeholder="ใช้ข้อมูลตัวอย่าง ไม่ต้องกรอก token จริง" value="${escape(draft.token ?? (c.credentials ? "DEMO-ACCESS-TOKEN" : ""))}" autocomplete="off"><small>ค่าที่กรอกใน preview ไม่ได้ส่งไป LINE</small></div><div class="field wide"><label for="secret">Channel secret</label><input id="secret" name="secret" type="password" value="${escape(draft.secret ?? (c.credentials ? "DEMO-CHANNEL-SECRET" : ""))}" placeholder="ตัวอย่าง: DEMO-CHANNEL-SECRET" autocomplete="off"></div></div><div id="form-error" class="small error" role="alert"></div><div class="form-actions">${btn("ใช้ข้อมูลตัวอย่าง", "sample-credentials", "", "quiet")}<button class="button primary" type="submit">${c.credentials ? "ตรวจการเชื่อมต่ออีกครั้ง" : "ตรวจการเชื่อมต่อ"}</button></div></form><hr class="divider"><div class="section-title"><h2>ความพร้อมของช่องทาง</h2></div><ul class="readiness"><li><span class="step-dot">${c.credentials ? icon("check") : "1"}</span><div class="step-body"><strong>ข้อมูล OA และ credentials</strong><p>${c.credentials ? "ตรวจผ่านด้วยข้อมูลตัวอย่างแล้ว" : "กรอกข้อมูลและตรวจการเชื่อมต่อก่อน"}</p></div>${badge(c.credentials ? "ผ่านแล้ว" : "ยังไม่ครบ", c.credentials ? "good" : "pending")}</li><li><span class="step-dot">${c.webhook ? icon("check") : "2"}</span><div class="step-body"><strong>เปิดรับข้อความผ่าน webhook</strong><p>คัดลอก URL ไปตั้งใน LINE Developers และเปิด Use webhook</p></div>${btn(c.webhook ? "ดูการตั้งค่า" : "ตั้ง webhook", "webhook", c.credentials ? "" : "disabled")}</li><li><span class="step-dot">${c.tested ? icon("check") : "3"}</span><div class="step-body"><strong>ทดสอบรับและตอบข้อความ</strong><p>${c.tested ? "จำลองรับข้อความและตอบกลับผ่านแล้ว" : "เพิ่มเพื่อน OA แล้วส่งข้อความทดสอบ"}</p></div>${btn("ทดสอบ", "test-connection", c.webhook ? "" : "disabled")}</li></ul><div class="form-actions">${badge(c.active ? "เปิดใช้งานแล้ว" : "ยังไม่เปิดใช้", c.active ? "good" : "pending")}${btn(c.active ? "พักใช้งานช่องทาง" : "เปิดใช้งาน LINE พนักงาน", "activate", !c.tested ? "disabled" : "", c.active ? "" : "primary")}</div><details><summary>ยังไม่มี LINE OA หรือใช้ OA กับระบบอื่นอยู่?</summary><div class="notice">สร้าง OA และเปิด Messaging API ใน LINE OA Manager ก่อน หากมี webhook ของระบบอื่นอยู่ ให้เลือกวิธีย้ายหรือใช้ตัวกลางก่อนเปลี่ยน URL <a href="https://developers.line.biz/en/docs/messaging-api/getting-started/" target="_blank" rel="noreferrer">ดูคู่มือ LINE</a></div></details></section><aside class="stack"><div class="panel panel-pad"><h2>${escape(c.name)}</h2><p class="muted small" style="margin:7px 0 18px">OA สำหรับพนักงาน · โรงงานบางนา</p><dl class="info-list"><div><dt>การเชื่อมต่อ</dt><dd>${badge(ready() ? "พร้อมใช้งาน" : c.outage ? "ขัดข้อง" : "รอตั้งค่า", ready() ? "good" : "pending")}</dd></div><div><dt>ผู้ช่วยเริ่มต้น</dt><dd>${bots[state.bot.default]}</dd></div><div><dt>เวลาเงียบ</dt><dd>${state.bot.quietStart}–${state.bot.quietEnd}</dd></div></dl></div>${notice("ลำดับแนะนำ: เชื่อม OA → ตั้งผู้ช่วยและแบบข้อความ → เชื่อมพนักงาน → ส่งและติดตาม")}${link("ตั้งผู้ช่วย HR", "bot", "", "bot")}${link("ลอง flow ทั้งหมด", "flow", "quiet", "flow")}</aside></div>`
    );
  }
  function botView() {
    const b = { ...state.bot, ...(state.drafts.bot || {}) };
    return (
      header(
        "ผู้ช่วย HR และการแจ้งเตือน",
        "พนักงานใหม่ใช้ผู้ช่วยเริ่มต้นทันที เปลี่ยนรายคนได้จากแถวใน HR",
      ) +
      `<div class="split"><form data-form="bot"><div class="section-title"><h2>ผู้ช่วยเริ่มต้นขององค์กร</h2></div>${Object.entries(
        bots,
      )
        .map(
          ([id, name]) =>
            `<div class="option-row"><input type="radio" id="bot-${id}" name="default" value="${id}" ${b.default === id ? "checked" : ""}><label for="bot-${id}"><strong>${name}</strong><p>${id === "standard" ? "คำถาม HR พื้นฐาน ตารางงาน และลิงก์คำขอของตนเอง" : "ช่วยดูเวลางานตามกะ และเตือนเรื่องเวลาที่เกี่ยวกับตนเอง"}</p></label>${id === b.default ? badge("ค่าเริ่มต้น", "blue") : ""}</div>`,
        )
        .join(
          "",
        )}<hr class="divider"><div class="field"><label for="welcome">ข้อความต้อนรับหลังเชื่อมบัญชี</label><textarea id="welcome" name="welcome" rows="3" maxlength="600">${escape(b.welcome)}</textarea><small>ใช้ {{employeeName}} เพื่อแสดงชื่อพนักงาน</small></div><hr class="divider"><div class="section-title"><h2>เหตุการณ์ที่แจ้งพนักงาน</h2><p>เปิดเฉพาะเหตุการณ์ที่องค์กรต้องการส่ง</p></div>${[
        ["correction", "ผลคำขอแก้ไขเวลา", "แจ้งเมื่อ HR รับรองหรือส่งคำขอกลับ"],
        ["clock", "เตือนลงเวลา", "ตัวอย่างกฎ: ยังไม่ลงเวลา 15 นาทีหลังเริ่มกะ"],
        ["holiday", "วันหยุดของไซต์", "แจ้งวันหยุดที่เกี่ยวกับพนักงานคนนั้น"],
      ]
        .map(
          ([key, title, sub]) =>
            `<div class="check-row"><input type="checkbox" id="notify-${key}" name="${key}" ${b[key] === true || b[key] === "on" ? "checked" : ""}><label for="notify-${key}"><strong>${title}</strong><p>${sub}</p></label></div>`,
        )
        .join(
          "",
        )}<hr class="divider"><div class="fields"><div class="field"><label for="quiet-start">เริ่มเวลาเงียบ</label><input type="time" id="quiet-start" name="quietStart" value="${b.quietStart}"></div><div class="field"><label for="quiet-end">สิ้นสุดเวลาเงียบ</label><input type="time" id="quiet-end" name="quietEnd" value="${b.quietEnd}"><small>ตามเวลา Asia/Bangkok · เก็บข้อความไว้ส่งภายหลัง</small></div></div><div class="form-actions"><button class="button primary" type="submit">บันทึกการตั้งค่า</button></div></form><aside class="preview-sticky"><div class="preview-label">ข้อความต้อนรับตัวอย่าง</div>${phone(lineText(personalize(b.welcome)))}<p class="preview-note">อ่านข้อมูลเฉพาะพนักงานที่ยืนยันแล้ว<br>การแก้เวลาและการอนุมัติยังทำในหน้า HR</p></aside></div>` +
      `<details><summary>ลองเหตุการณ์ HR ของ${employee().short}ในตัวอย่าง</summary><p class="small muted" style="margin-top:12px">ใช้ค่าที่บันทึกแล้ว เวลา 10:30 ของตัวอย่าง และไม่แจ้งเหตุการณ์เดิมซ้ำ</p><div class="header-actions" style="margin-top:13px">${btn("คำขอแก้ไขเวลาได้รับรอง", "notify-event", 'data-kind="correction"')}${btn("ยังไม่ลงเวลาเข้างาน", "notify-event", 'data-kind="clock"')}${btn("วันหยุดของไซต์", "notify-event", 'data-kind="holiday"')}</div></details>`
    );
  }
  function employeeActions(e) {
    return `${e.account ? link(e.line === "connected" ? "ดูการเชื่อม" : e.line === "blocked" ? "เชื่อมใหม่" : "เชื่อม LINE", `employees/link?id=${e.id}`) : btn("เชื่อมบัญชีสมาชิก", "member-link", `data-id="${e.id}"`)} ${btn("เลือก bot", "assign-bot", `data-id="${e.id}"`, "quiet")}`;
  }
  function employeesView() {
    return (
      header(
        "พนักงานและ LINE",
        "เชื่อมบัญชีส่วนตัว และกำหนดผู้ช่วย HR ได้จากแต่ละแถว",
        link("มุมพนักงาน", "employee/home", "", "eye"),
      ) +
      (!ready()
        ? `<div class="provider-state">${notice("ช่องทางยังไม่พร้อม เปิดใช้งาน LINE ก่อนสร้างคำเชิญเชื่อมบัญชี " + link("ไปตั้งค่า", "connection", "quiet"), "warning")}</div>`
        : "") +
      `<div class="search-row"><label class="sr-only" for="employee-search">ค้นหาพนักงาน</label><input class="search" id="employee-search" placeholder="ค้นหาชื่อหรือรหัสพนักงาน" autocomplete="off"><span class="muted small">โรงงานบางนา · ${state.employees.length} คน</span></div><div class="panel desktop-person-table"><div class="table-scroll"><table><thead><tr><th>พนักงาน</th><th>บัญชีระบบ</th><th>LINE</th><th>ผู้ช่วย HR</th><th>จัดการ</th></tr></thead><tbody>${state.employees.map((e) => `<tr data-employee-row data-search="${escape((e.name + e.code).toLowerCase())}"><td><div class="person"><span class="avatar">${e.short.slice(0, 1)}</span><div><strong>${e.name}</strong><p>${e.code} · ${e.job}</p></div></div></td><td>${badge(e.account ? "เชื่อมสมาชิกแล้ว" : "ยังไม่มีสมาชิก", e.account ? "" : "pending")}</td><td>${rowStatus(e)}</td><td>${botName(e)}<p class="muted small">${e.bot === "default" ? "ตามค่าเริ่มต้นองค์กร" : "กำหนดเฉพาะคน"}</p></td><td><div class="row-actions">${employeeActions(e)}</div></td></tr>`).join("")}</tbody></table></div></div><div class="mobile-person-cards">${state.employees.map((e) => `<section class="mobile-person-card" data-employee-row data-search="${escape((e.name + e.code).toLowerCase())}"><div class="person"><span class="avatar">${e.short[0]}</span><div><strong>${e.name}</strong><p>${e.code} · ${e.job}</p></div></div><dl class="info-list"><div><dt>บัญชีระบบ</dt><dd>${e.account ? "เชื่อมแล้ว" : "ยังไม่มีสมาชิก"}</dd></div><div><dt>LINE</dt><dd>${rowStatus(e)}</dd></div><div><dt>ผู้ช่วย</dt><dd>${botName(e)}</dd></div></dl><div class="row-actions">${employeeActions(e)}</div></section>`).join("")}</div><p class="muted small" style="margin-top:18px">การเชื่อม LINE ไม่เพิ่มสิทธิ์ HR ข้อมูลที่ผู้ช่วยอ่านได้ยังอิงบัญชีสมาชิกและไซต์ของพนักงาน</p>`
    );
  }
  function employeeLinkView(id) {
    const e = employee(id),
      invite =
        ready() && e.account && e.line !== "connected"
          ? ensureInvite(id)
          : state.invitations[id];
    let content;
    if (e.line === "connected") {
      content = `<div class="panel panel-pad"><div class="person"><span class="avatar">${e.short[0]}</span><div><h2>${escape(e.lineName)}</h2><p>บัญชี LINE ที่ยืนยันกับ ${e.code}</p></div></div><hr class="divider"><dl class="info-list"><div><dt>ผู้ช่วย HR</dt><dd>${botName(e)}</dd></div><div><dt>การแจ้งเตือน</dt><dd>${e.notifications ? "เปิดรับ" : "ปิดรับ"}</dd></div><div><dt>บัญชีระบบ</dt><dd>${e.name}</dd></div></dl><div class="form-actions">${btn("ยกเลิกการเชื่อม", "unlink", `data-id="${e.id}"`, "danger")}${link("ดู LINE ของพนักงาน", `employee/chat?id=${e.id}`, "primary")}</div></div>`;
    } else {
      content = `<div class="section-title"><h2>ให้พนักงานยืนยันบัญชีของตนเอง</h2><p>ส่งลิงก์หรือให้สแกน QR จากนั้นพนักงานเพิ่มเพื่อน OA และเข้าสู่ระบบ</p></div>`;
      if (!ready())
        content += notice(
          "ช่องทางยังไม่พร้อม กรุณากลับไปตั้งค่า LINE ก่อน",
          "warning",
        );
      else if (!e.account)
        content += notice(
          "ต้องเชื่อมพนักงานกับบัญชีสมาชิกก่อน เพื่อยืนยันตัวตนอย่างถูกต้อง",
          "warning",
        );
      else
        content += `<div class="panel panel-pad"><div class="qr" id="link-qr"></div><p class="small muted" style="text-align:center">QR สำหรับ flow จำลอง · อายุคำเชิญ 10 นาที</p><div class="link-address" id="link-address">${escape(linkUrl(e.id))}</div><div class="form-actions">${btn(icon("copy") + "คัดลอกลิงก์", "copy-link", `data-id="${e.id}"`)}${link("ลองเป็นพนักงานคนนี้", `employee/link?id=${e.id}`, "primary")}</div>${invite?.expired ? `<div style="margin-top:18px">${notice("คำเชิญเดิมหมดอายุ สร้างคำเชิญใหม่แล้วลองเชื่อมอีกครั้ง", "warning")}</div>` : ""}</div><div class="form-actions">${btn("สร้างคำเชิญใหม่", "invite-renew", `data-id="${e.id}"`, "quiet")}${btn("ยกเลิกคำเชิญ", "invite-cancel", `data-id="${e.id}"`, "quiet")}</div>`;
    }
    return (
      back("employees", "กลับรายชื่อพนักงาน") +
      header(
        `LINE ของ${e.short}`,
        `${e.code} · ${e.site}`,
        badge(
          e.line === "connected"
            ? "เชื่อมแล้ว"
            : e.line === "blocked"
              ? "ต้องเชื่อมใหม่"
              : "รอยืนยัน",
          e.line === "connected" ? "good" : "pending",
        ),
      ) +
      `<div class="split wide"><section>${content}</section><aside class="stack">${notice("QR ใช้เริ่มการเชื่อมเท่านั้น พนักงานต้อง login เป็นบัญชีที่ผูกกับแถวนี้ก่อน ระบบจึงบันทึกการเชื่อม")}<div><h2>หลังเชื่อมสำเร็จ</h2><dl class="info-list"><div><dt>สถานะในแถว HR</dt><dd>เชื่อมแล้ว</dd></div><div><dt>ผู้ช่วยที่ได้รับ</dt><dd>${botName(e)}</dd></div><div><dt>ข้อความแรก</dt><dd>ต้อนรับและวิธีถาม HR</dd></div></dl></div>${btn("เปลี่ยนผู้ช่วยรายคน", "assign-bot", `data-id="${e.id}"`)}</aside></div>`
    );
  }
  function cardsView() {
    return (
      header(
        "แบบข้อความ Card",
        "เลือกแบบสำเร็จรูป ปรับเนื้อหา และดูตัวอย่างก่อนส่งให้พนักงาน",
      ) +
      `<div class="templates">${state.templates.map((t) => `<section class="template-row"><div class="template-copy"><h2>${t.name}</h2><p>${t.title}</p><div class="tag-row">${badge(t.kind)}${badge(t.ack ? "ต้องกดรับทราบ" : "แจ้งอย่างเดียว", t.ack ? "blue" : "")}${badge(`รุ่น ${t.version}`)}</div></div><div class="template-actions">${link("แก้ไขและ Preview", `cards/edit?id=${t.id}`)}${link("ใช้ส่งข้อความ", `send?id=${t.id}`, "primary")}</div></section>`).join("")}</div><hr class="divider">${notice("การแก้แบบข้อความมีผลกับการส่งครั้งต่อไป ข้อความที่ส่งไปแล้วคงเนื้อหาและรุ่นเดิมไว้")}`
    );
  }
  function cardEditView(id) {
    const t = { ...template(id), ...(state.drafts[activeRoute] || {}) };
    const ack = t.ack === true || t.ack === "on";
    t.ack = ack;
    return (
      back("cards", "กลับแบบข้อความ") +
      header(t.name, "ข้อความเดียวกันใช้แสดงใน LINE และหน้าอ่านของพนักงาน") +
      `<div class="split"><form data-form="template" data-id="${t.id}"><div class="fields"><div class="field wide"><label for="template-title">หัวข้อข้อความ</label><input id="template-title" name="title" value="${escape(t.title)}" maxlength="90" required></div><div class="field wide"><label for="template-body">เนื้อหา Card</label><textarea id="template-body" name="body" rows="8" maxlength="1600" required>${escape(t.body)}</textarea><small>ตัวแปรที่ใช้ได้: {{employeeName}}, {{siteName}}, {{date}}, {{time}}</small></div></div><div class="check-row"><input type="checkbox" name="ack" id="require-ack" ${ack ? "checked" : ""}><label for="require-ack"><strong>ให้พนักงานกดรับทราบ</strong><p>HR จะติดตามว่าใครยืนยันข้อความรุ่นนี้แล้ว</p></label></div><div class="field" style="margin-top:17px"><label for="button-label">ข้อความบนปุ่มรับทราบ</label><input id="button-label" name="label" value="${escape(t.label)}" maxlength="24"><small>ข้อความทั่วไปมีปุ่มดูรายละเอียดอย่างเดียวได้</small></div><div id="form-error" role="alert" class="small error"></div><div class="form-actions">${btn("ยกเลิก", "cancel-edit", 'data-parent="cards"')}<button class="button primary" type="submit">บันทึกแบบข้อความ</button></div></form><aside class="preview-sticky"><div class="preview-label"><span>ตัวอย่างฝั่งพนักงาน</span>${badge("ไม่ส่งจริง")}</div><div id="live-card-preview">${phone(flex(t, employee(), { preview: true }))}</div><p class="preview-note">กดปุ่มบน Card เพื่อลองข้อความตอบกลับได้</p></aside></div>`
    );
  }
  function sendView(id) {
    const t = template(id),
      d = state.drafts[activeRoute] || {},
      selected = d.audience
        ? d.audience.split(",")
        : state.employees.filter((e) => e.account).map((e) => e.id);
    return (
      header(
        "ส่งข้อความให้พนักงาน",
        "เลือกผู้รับและเวลาส่ง ข้อมูลตัวอย่างจะไปปรากฏในมุมพนักงาน",
        link("ดูการติดตาม", "tracking", "", "chart"),
      ) +
      `<div class="split"><form data-form="publish"><div class="field"><label for="send-template">แบบข้อความ</label><select id="send-template" name="template">${state.templates.map((x) => `<option value="${x.id}" ${x.id === t.id ? "selected" : ""}>${x.name}</option>`).join("")}</select></div><hr class="divider"><div class="section-title"><h2>ผู้รับข้อความ</h2><p>ผู้รับทุกคนมีข้อความในแอป แม้ยังไม่ได้เชื่อม LINE</p></div>${state.employees.map((e) => `<div class="check-row"><input type="checkbox" name="recipient" id="recipient-${e.id}" value="${e.id}" ${selected.includes(e.id) ? "checked" : ""} ${!e.account || !e.active ? "disabled" : ""}><label for="recipient-${e.id}"><strong>${e.name}</strong><p>${e.code} · ${!e.account ? "ต้องเชื่อมบัญชีสมาชิกก่อน" : e.line === "connected" ? "LINE และข้อความในแอป" : e.line === "blocked" ? "อ่านข้อความในแอปได้ · LINE ถูกบล็อก" : "อ่านข้อความในแอปได้ · ยังไม่เชื่อม LINE"}</p></label></div>`).join("")}<hr class="divider"><div class="fields"><div class="field"><label for="send-when">เวลาส่ง</label><select id="send-when" name="when"><option value="now" ${d.when !== "schedule" ? "selected" : ""}>ส่งทันที</option><option value="schedule" ${d.when === "schedule" ? "selected" : ""}>ตั้งเวลาส่ง</option></select></div><div class="field" id="schedule-field" ${d.when !== "schedule" ? "hidden" : ""}><label for="schedule-time">วันที่และเวลา</label><input id="schedule-time" name="schedule" type="datetime-local" value="${escape(d.schedule || "2026-10-16T08:00")}"><small>Asia/Bangkok · เวลาปัจจุบันตัวอย่าง 13 ต.ค. 10:30</small></div></div><div id="send-summary" class="notice" style="margin-top:21px">${selected.length} คน · ${t.ack ? "ต้องกดรับทราบ" : "แจ้งอย่างเดียว"} · ข้อความรุ่น ${t.version}</div><div id="form-error" role="alert" class="small error"></div><div class="form-actions"><button class="button primary" type="submit" ${ready() ? "" : "disabled"}>ตรวจสอบและ${d.when === "schedule" ? "ตั้งเวลาส่ง" : "ส่งข้อความ"}</button></div>${!ready() ? `<p class="disabled-note">ช่องทาง LINE ยังไม่พร้อม ${link("ไปแก้การเชื่อมต่อ", "connection", "quiet")}</p>` : ""}</form><aside class="preview-sticky"><div class="preview-label"><span>ข้อความที่จะส่ง</span>${badge("ตัวอย่าง")}</div>${phone(flex(t, employee(), { preview: true }))}<p class="preview-note">ส่งแล้วแก้เนื้อหารุ่นเดิมไม่ได้<br>หากต้องแก้ ให้สร้างรุ่นใหม่และส่งอีกครั้ง</p></aside></div>`
    );
  }
  function trackingView() {
    return (
      header(
        "ติดตามข้อความและการรับทราบ",
        "แยกสถานะการส่ง การเปิดรายละเอียด และการยืนยันของพนักงาน",
        link("ส่งข้อความใหม่", "send", "primary", "send"),
      ) +
      (state.publications.length
        ? `<div class="panel"><div class="table-scroll"><table><thead><tr><th>ข้อความ</th><th>ผู้รับ</th><th>รับทราบ</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>${[
            ...state.publications,
          ]
            .reverse()
            .map(
              (p) =>
                `<tr><td><strong>${escape(p.title)}</strong><p class="muted small">${p.at} · รุ่น ${p.version}</p></td><td>${p.recipients.length} คน</td><td>${p.ack ? `${p.recipients.filter((r) => r.ackAt).length}/${p.recipients.length} คน` : "ไม่ต้องรับทราบ"}</td><td>${badge(p.state === "scheduled" ? "ตั้งเวลาแล้ว" : p.state === "withdrawn" ? "ยกเลิกแล้ว" : "เผยแพร่แล้ว", p.state === "published" ? "good" : p.state === "scheduled" ? "pending" : "")}</td><td>${link("ดูผู้รับ", `tracking/detail?id=${p.id}`)}</td></tr>`,
            )
            .join("")}</tbody></table></div></div>`
        : `<div class="empty"><h2>ยังไม่มีข้อความที่ส่ง</h2><p>เลือกแบบข้อความและส่งรายการแรกเพื่อเริ่มติดตาม</p>${link("ส่งข้อความ", "send", "primary")}</div>`) +
      `<p class="muted small" style="margin-top:18px">API รับคำขอส่งแล้ว ไม่ใช่หลักฐานว่าพนักงานอ่านหรือได้รับข้อความ</p>`
    );
  }
  function trackingDetailView(id) {
    const p = publication(id);
    if (!p) return notFound();
    return (
      back("tracking", "กลับรายการข้อความ") +
      header(
        escape(p.title),
        `${p.at} · ข้อความรุ่น ${p.version}`,
        `${p.state === "published" ? btn("ยกเลิกข้อความนี้", "withdraw", `data-id="${p.id}"`, "danger") : ""}`,
      ) +
      `<div class="summary-strip"><div><strong>${p.recipients.length}</strong><span>ผู้รับ</span></div><div><strong>${p.recipients.filter((r) => r.opened).length}</strong><span>เปิดรายละเอียดในแอป</span></div><div><strong>${p.recipients.filter((r) => r.ackAt).length}</strong><span>กดรับทราบ</span></div></div>${p.state === "scheduled" ? `<div class="provider-state">${notice(`ตั้งเวลาส่ง ${escape(p.schedule.replace("T", " "))} · ยังไม่แสดงในมุมพนักงาน ${btn("ไปถึงเวลาส่งในตัวอย่าง", "run-scheduled", `data-id="${p.id}"`, "quiet")}`, "warning")}</div>` : p.state === "withdrawn" ? `<div class="provider-state">${notice("ข้อความนี้ถูกยกเลิกแล้ว เก็บประวัติการรับทราบเดิม และไม่รับการยืนยันใหม่", "warning")}</div>` : ""}<div class="panel"><div class="table-scroll"><table><thead><tr><th>พนักงาน</th><th>ส่งผ่าน LINE</th><th>เปิดรายละเอียด</th><th>รับทราบ</th><th>ลองดู</th></tr></thead><tbody>${p.recipients
        .map((r) => {
          const e = employee(r.employee);
          return `<tr><td><strong>${e.name}</strong><p class="muted small">${e.code}${r.reminders ? ` · สร้างรายการเตือน ${r.reminders} ครั้ง` : ""}</p></td><td>${badge(deliveryLabel(r.delivery), r.delivery === "accepted" ? "" : "pending")}</td><td>${r.opened ? "เปิดแล้ว" : "ยังไม่เปิด"}</td><td>${!p.ack ? "ไม่ต้องรับทราบ" : r.ackAt ? `${badge("รับทราบแล้ว", "good")}<p class="muted small">${r.ackAt}</p>` : badge("รอรับทราบ", "pending")}</td><td>${link("มุมพนักงาน", `employee/home?id=${e.id}`)}</td></tr>`;
        })
        .join(
          "",
        )}</tbody></table></div></div><div class="form-actions">${p.ack && p.state === "published" ? btn("เตือนเฉพาะคนที่ยังไม่รับทราบ", "remind", `data-id="${p.id}"`, "primary") : ""}</div><details><summary>ดูข้อความที่เผยแพร่รุ่นนี้</summary><div class="article"><p>${escape(personalize(p.body))}</p></div></details>`
    );
  }
  function employeeHomeView() {
    const e = employee(),
      list = state.publications.filter(
        (p) =>
          p.state === "published" &&
          p.recipients.some((r) => r.employee === e.id),
      );
    return (
      header(
        `สวัสดี ${e.short}`,
        `${e.code} · ${e.site} · ${e.job}`,
        `<span>${rowStatus(e)}</span>`,
      ) +
      (!e.account
        ? notice(
            "บัญชีสมาชิกตัวอย่างยังไม่ได้เชื่อมกับพนักงานคนนี้ ให้ HR เชื่อมสมาชิกก่อนเข้าข้อมูลส่วนตัว",
            "warning",
          )
        : `<div class="split wide"><section><div class="section-title"><h2>ข้อความของฉัน</h2><p>อ่านและรับทราบได้ในแอป แม้ยังไม่ได้เชื่อม LINE</p></div>${
            list.length
              ? list
                  .map((p) => {
                    const r = p.recipients.find((r) => r.employee === e.id);
                    return `<article class="publication"><div class="tag-row">${badge(p.kind)}${p.ack ? badge(r.ackAt ? "รับทราบแล้ว" : "รอรับทราบ", r.ackAt ? "good" : "pending") : ""}</div><h3 style="margin-top:9px">${escape(p.title)}</h3><p>${p.at} · แจ้งโดย HR</p>${link("อ่านรายละเอียด", `employee/message?id=${p.id}`)}</article>`;
                  })
                  .join("")
              : '<div class="empty"><h2>ไม่มีข้อความใหม่</h2><p>ประกาศและแจ้งเตือนที่เกี่ยวกับคุณจะอยู่ที่นี่</p></div>'
          }</section><aside class="stack"><div class="panel panel-pad"><h2>ผู้ช่วย HR ของคุณ</h2><p class="muted small" style="margin:7px 0 18px">${botName(e)} · ตารางงานและเรื่อง HR ของตนเอง</p>${link(e.line === "connected" ? "เปิด LINE ผู้ช่วย HR" : "เชื่อม LINE ของฉัน", e.line === "connected" ? "employee/chat" : `employee/link?id=${e.id}`, "primary full", "chat")}</div><dl class="info-list"><div><dt>ตารางวันนี้</dt><dd>${e.id === "e3" ? "20:00–05:00 (+1 วัน)" : "08:30–17:30"}</dd></div><div><dt>สถานะลงเวลา</dt><dd>เข้างาน 08:27</dd></div><div><dt>คำขอล่าสุด</dt><dd>แก้ไขเวลา · รับรองแล้ว</dd></div></dl>${link("ตั้งค่าการรับแจ้งเตือน", "employee/profile", "quiet", "bell")}</aside></div>`)
    );
  }
  function messageView(id) {
    const e = employee(),
      p = publication(id),
      r = p?.recipients.find((r) => r.employee === e.id);
    if (!e.account || !p || !r || p.state === "scheduled")
      return notFound("ไม่พบข้อความที่คุณมีสิทธิ์อ่าน");
    if (p.state === "published" && !r.opened) {
      r.opened = true;
      save();
    }
    return (
      back("employee/home", "กลับข้อความของฉัน") +
      header(
        escape(p.title),
        `${p.at} · แจ้งโดย HR · ข้อความรุ่น ${p.version}`,
      ) +
      `<article class="article"><p>${escape(personalize(p.body, e))}</p>${p.state === "withdrawn" ? notice("HR ยกเลิกข้อความนี้แล้ว ไม่ต้องรับทราบเพิ่มเติม", "warning") : r.ackAt ? `<div class="receipt">${notice(`คุณรับทราบข้อความรุ่น ${p.version} แล้ว · ${r.ackAt}`, "success")}</div>` : p.ack ? `<div class="form-actions">${btn(escape(p.label), "ack", `data-id="${p.id}" data-employee="${e.id}" data-channel="app"`, "primary")}</div>` : notice("ข้อความนี้แจ้งเพื่อทราบ ไม่จำเป็นต้องกดยืนยัน")}</article>`
    );
  }
  function chatView() {
    const e = employee(),
      pList = state.publications.filter(
        (p) =>
          p.state !== "scheduled" &&
          p.recipients.some(
            (r) => r.employee === e.id && r.delivery === "accepted",
          ),
      );
    if (!bound(e))
      return (
        header("LINE ผู้ช่วย HR", `บัญชีของ${e.short}`) +
        `<div class="empty"><h2>${e.line === "blocked" ? "บัญชี LINE นี้ถูกบล็อก" : "ยังไม่ได้เชื่อม LINE"}</h2><p>ยืนยันบัญชีเพื่อใช้ผู้ช่วย HR หรืออ่านข้อความในแอปได้ก่อน</p>${link("เชื่อม LINE ของฉัน", `employee/link?id=${e.id}`, "primary")}${link("อ่านข้อความในแอป", "employee/home", "quiet")}</div>`
      );
    const thread = state.threads[e.id],
      chats = state.chats[e.id] || [];
    return (
      header(
        "LINE ผู้ช่วย HR",
        `ตัวอย่างแชทของ${e.short} · ${botName(e)}`,
        link("ข้อความในแอป", "employee/home", "", "card"),
      ) +
      `<div class="employee-layout">${phone(lineText(personalize(state.bot.welcome, e)) + pList.map((p) => flex(p, e, { pubId: p.id })).join("") + chats.map((m) => lineText(m.text, m.from)).join(""), { compose: true, id: "employee-phone" })}<aside class="stack"><div class="section-title"><h2>ลองถามผู้ช่วย</h2><p>คำตอบใช้ข้อมูลตัวอย่างของพนักงานคนนี้เท่านั้น</p></div><div class="header-actions">${btn("ตารางงานวันนี้", "quick-chat", 'data-text="ตารางงานวันนี้"')}${btn("ผลคำขอแก้ไขเวลา", "quick-chat", 'data-text="ผลคำขอแก้ไขเวลา"')}${btn("วันหยุดถัดไป", "quick-chat", 'data-text="วันหยุดถัดไป"')}</div>${notice(thread?.mode === "human" ? "HR รับช่วงดูแลบทสนทนานี้ ผู้ช่วยจะพักการตอบจนกว่า HR จะคืนให้ bot" : thread?.mode === "waiting" ? "ส่งเรื่องให้ HR แล้ว คุณส่งข้อมูลเพิ่มเติมในแชทนี้ได้" : "ผู้ช่วยตอบคำถามและเปิดงาน HR ให้คุณ การแก้ไขข้อมูลยังยืนยันในแอป")}${btn("คุยกับเจ้าหน้าที่ HR", "handoff", "", "primary")}${thread ? link("ลองเป็น HR รับช่วงตอบ", `inbox?id=${e.id}`, "quiet", "chat") : ""}<p class="small muted">Card เดิมยังอยู่หลังรับทราบ ระบบจะส่งข้อความยืนยันใหม่ และการกดซ้ำไม่สร้างการรับทราบเพิ่ม</p></aside></div>`
    );
  }
  function employeeProfileView() {
    const e = employee();
    return (
      header("บัญชีและการแจ้งเตือน", `${e.name} · ${e.code}`) +
      `<div class="split wide"><section><div class="section-title"><h2>LINE ที่เชื่อมกับคุณ</h2></div><dl class="info-list"><div><dt>สถานะ</dt><dd>${rowStatus(e)}</dd></div><div><dt>ชื่อ LINE</dt><dd>${e.line === "unlinked" ? "—" : escape(e.lineName)}</dd></div><div><dt>ผู้ช่วย HR</dt><dd>${botName(e)}</dd></div></dl><div class="form-actions">${e.line === "connected" ? btn("ยกเลิกการเชื่อม LINE", "unlink", `data-id="${e.id}"`, "danger") : link("เชื่อม LINE ของฉัน", `employee/link?id=${e.id}`, "primary")}</div><hr class="divider"><div class="check-row"><input id="employee-notifications" type="checkbox" ${e.notifications ? "checked" : ""} data-action="notification-toggle"><label for="employee-notifications"><strong>รับการแจ้งเตือนผ่าน LINE</strong><p>ข้อความในแอปยังคงอยู่เมื่อปิดการแจ้งเตือน</p></label></div><dl class="info-list"><div><dt>เวลาเงียบขององค์กร</dt><dd>${state.bot.quietStart}–${state.bot.quietEnd}</dd></div><div><dt>Timezone</dt><dd>Asia/Bangkok</dd></div></dl></section><aside>${notice("การยกเลิก LINE ไม่ลบบัญชีพนักงานหรือประวัติ HR คุณยังใช้ข้อมูลของตนเองในแอปได้")}</aside></div>`
    );
  }
  function bindingView(id) {
    const e = employee(id),
      inv = ensureInvite(e.id);
    return (
      back(
        state.role === "hr" ? `employees/link?id=${e.id}` : "employee/home",
        "กลับ",
      ) +
      header(
        "เชื่อมบัญชีพนักงานกับ LINE",
        `${e.name} · ${e.code} · OA ${state.connection.name}`,
      ) +
      `<div class="link-login">${
        !ready()
          ? notice(
              "LINE OA ยังไม่พร้อม ให้ HR เปิดใช้การเชื่อมต่อก่อน",
              "warning",
            )
          : !e.account
            ? notice(
                "พนักงานคนนี้ยังไม่ได้เชื่อมบัญชีสมาชิก ให้ HR เชื่อมสมาชิกก่อน",
                "warning",
              )
            : e.line === "connected"
              ? `${notice("บัญชีนี้เชื่อมแล้ว คุณเปิดผู้ช่วย HR ได้เลย", "success")}<div class="form-actions">${link("เปิดผู้ช่วย HR", `employee/chat?id=${e.id}`, "primary")}</div>`
              : `<div class="panel panel-pad"><div class="connect-step"><span class="step-dot">${inv.friend ? icon("check") : "1"}</span><div class="step-body"><h2>เพิ่มเพื่อน LINE OA</h2><p>SiamPack HR · ผู้ช่วยสำหรับพนักงาน</p>${btn(inv.friend ? "เพิ่มเพื่อนแล้ว" : "เพิ่มเพื่อนในตัวอย่าง", "friend", `data-id="${e.id}" ${inv.friend ? "disabled" : ""}`, "primary")}</div></div><div class="connect-step"><span class="step-dot">2</span><div class="step-body"><h2>เข้าสู่ระบบด้วยบัญชีของคุณ</h2><p>ระบบต้องยืนยันว่าคุณเป็นพนักงานในคำเชิญนี้</p><form data-form="bind" data-id="${e.id}"><div class="field"><label for="login-as">บัญชีที่เข้าสู่ระบบในตัวอย่าง</label><select id="login-as" name="actor">${state.employees
                  .filter((x) => x.account)
                  .map(
                    (x) =>
                      `<option value="${x.id}" ${x.id === e.id ? "selected" : ""}>${x.name} · ${x.code}</option>`,
                  )
                  .join(
                    "",
                  )}</select></div><div id="form-error" class="small error" role="alert"></div><div class="form-actions"><button class="button primary" type="submit" ${inv.friend ? "" : "disabled"}>ยืนยันและเชื่อมบัญชี</button></div></form></div></div><p class="small muted" style="margin-top:18px">เชื่อมกับข้อมูล HR ของตนเองเท่านั้น และยกเลิกการเชื่อมได้จากโปรไฟล์</p></div><details><summary>ลองกรณีคำเชิญหมดอายุ</summary><div class="form-actions">${btn("ทำให้คำเชิญหมดอายุ", "expire-invite", `data-id="${e.id}"`)}${btn("สร้างคำเชิญใหม่", "invite-renew", `data-id="${e.id}"`)}</div></details>`
      }</div>`
    );
  }
  function inboxView(id) {
    const threads = Object.values(state.threads),
      selected = state.threads[id] || threads[0];
    if (!threads.length)
      return (
        header(
          "กล่องข้อความ HR",
          "รับช่วงตอบเรื่องที่พนักงานส่งต่อจากผู้ช่วย",
        ) +
        `<div class="empty"><h2>ยังไม่มีเรื่องที่ส่งถึง HR</h2><p>ลองเปิด LINE ของพนักงาน แล้วกดคุยกับเจ้าหน้าที่ HR</p>${link("ลองมุมพนักงาน", "employee/chat", "primary")}</div>`
      );
    const e = employee(selected.employee);
    return (
      header(
        "กล่องข้อความ HR",
        "เรื่องของพนักงานที่ขอให้เจ้าหน้าที่ช่วย · ข้อมูลตัวอย่าง",
      ) +
      `<div class="inbox"><nav class="thread-list" aria-label="บทสนทนาพนักงาน">${threads.map((t) => `<button class="thread-item ${t.employee === e.id ? "active" : ""}" data-route="inbox?id=${t.employee}"><strong>${employee(t.employee).name}</strong><p>${t.mode === "human" ? "HR รับช่วงแล้ว" : t.mode === "waiting" ? "รอ HR รับช่วง" : "คืนให้ผู้ช่วยแล้ว"}</p>${badge(t.mode === "human" ? "คนตอบ" : t.mode === "waiting" ? "รอรับเรื่อง" : "ผู้ช่วยตอบ", t.mode === "waiting" ? "pending" : "")}</button>`).join("")}</nav><section class="thread-body"><div class="thread-top"><div><h2>${e.name}</h2><p class="small muted">${e.code} · ${e.site}</p></div><div class="header-actions">${btn(selected.mode === "human" ? "คืนให้ผู้ช่วย" : "รับช่วงตอบ", "thread-mode", `data-id="${e.id}"`, "primary")}</div></div><div class="thread-log">${selected.messages.map((m) => `<div class="message-bubble ${m.from === "hr" ? "mine" : ""}">${escape(m.text)}<small>${m.from === "hr" ? "พัชราภา · HR" : e.short} · ${m.time}</small></div>`).join("")}</div><form class="thread-compose" data-form="hr-reply" data-id="${e.id}"><input name="message" value="${escape(state.hrDrafts?.[e.id] || "")}" aria-label="ข้อความตอบพนักงาน" placeholder="${selected.mode === "human" ? "ตอบพนักงานผ่าน LINE…" : "รับช่วงตอบก่อนส่งข้อความ"}" ${selected.mode === "human" ? "" : "disabled"} required autocomplete="off"><button class="button primary" type="submit" ${selected.mode === "human" ? "" : "disabled"}>ส่ง</button></form></section></div><p class="small muted" style="margin-top:15px">เมื่อ HR รับช่วง ผู้ช่วยพักการตอบ จนกว่า HR จะกดคืนให้ผู้ช่วย</p>`
    );
  }
  function flowView() {
    const steps = [
      [
        "connection",
        "link",
        "ธุรกิจเชื่อม LINE OA",
        "ตรวจ credentials → เปิด webhook → ทดสอบรับส่งและเปิดใช้",
      ],
      [
        "bot",
        "bot",
        "ตั้งผู้ช่วย HR เริ่มต้น",
        "ข้อความต้อนรับ ประเภทแจ้งเตือน และเวลาเงียบ",
      ],
      [
        "employees",
        "users",
        "เชื่อมบัญชีพนักงาน",
        "HR ส่งคำเชิญ → พนักงานเพิ่มเพื่อนและยืนยันบัญชี → ใช้ bot เริ่มต้น",
      ],
      [
        "cards",
        "card",
        "ตั้ง Card อ่านง่าย",
        "หัวข้อ เนื้อหา ผู้รับ และปุ่มรับทราบที่เปิดเฉพาะเมื่อจำเป็น",
      ],
      [
        "send",
        "send",
        "ส่งทันทีหรือตั้งเวลา",
        "พนักงานทุกคนในกลุ่มได้รับข้อความในแอป LINE ส่งตามสถานะการเชื่อม",
      ],
      [
        "employee/home",
        "check",
        "พนักงานอ่านและรับทราบ",
        "อ่าน Card หรือเปิดรายละเอียด กดรับทราบครั้งเดียว",
      ],
      [
        "tracking",
        "chart",
        "HR ติดตามผลและเตือนคนที่ค้าง",
        "เก็บผู้รับ รุ่นข้อความ และเวลา ไม่ส่งเตือนคนที่ยืนยันแล้ว",
      ],
      [
        "inbox",
        "chat",
        "ส่งต่อเจ้าหน้าที่เมื่อมีคำถาม",
        "พนักงานขอคุย HR → คนรับช่วง → ตอบกลับ → คืนให้ผู้ช่วย",
      ],
    ];
    return (
      header(
        "Flow พนักงานครบตั้งแต่ตั้งค่าถึงรับทราบ",
        "กดแต่ละขั้นเพื่อเปิดหน้าจอ และลองทำงานต่อด้วยข้อมูลชุดเดียวกัน",
      ) +
      `<div class="workflow">${steps.map(([route, glyph, title, sub], i) => `${i ? `<div class="flow-arrow">${icon("down")}</div>` : ""}<a class="flow-step" href="#/${route}" data-route="${route}"><span class="step-dot">${i + 1}</span><div><h3>${title}</h3><p>${sub}</p></div></a>`).join("")}</div>`
    );
  }
  function notFound(message = "ไม่พบหน้าหรือข้อมูลนี้") {
    return (
      header(message, "ตรวจข้อมูลหรือกลับไปยังหน้าหลักของ preview") +
      link(
        "กลับหน้าหลัก",
        state.role === "employee" ? "employee/home" : "connection",
        "primary",
      )
    );
  }
  function linkUrl(id) {
    return `${location.origin}${location.pathname}#/employee/link?id=${encodeURIComponent(id)}`;
  }
  function ensureInvite(id) {
    const invite = (state.invitations[id] ||= {
      friend: false,
      expired: false,
      used: false,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    invite.expiresAt ||= Date.now() + 10 * 60 * 1000;
    if (employee(id).line === "unlinked" && employee(id).account && ready())
      employee(id).line = "pending";
    return invite;
  }
  function render(focus = false) {
    const { page, params, route } = routeData();
    activeRoute = route;
    if (page.startsWith("employee/")) state.role = "employee";
    else if (page !== "flow") state.role = "hr";
    const id = params.get("id");
    if (page.startsWith("employee/") && page !== "employee/message" && id)
      state.selectedEmployee = employee(id).id;
    dirty = Boolean(state.drafts[activeRoute]);
    document.documentElement.dataset.theme = state.theme;
    $("#theme-icon").innerHTML = icon(state.theme === "dark" ? "sun" : "moon");
    $("#scenario").value = state.scenario;
    $("#hr-role").classList.toggle("active", state.role === "hr");
    $("#employee-role").classList.toggle("active", state.role === "employee");
    $(".workspace-bar .employee-switch")?.remove();
    if (state.role === "employee") {
      const wrapper = document.createElement("span");
      wrapper.className = "employee-switch";
      wrapper.innerHTML = `<label class="sr-only" for="employee-select">พนักงานตัวอย่าง</label><select class="selected-employee" id="employee-select">${state.employees.map((e) => `<option value="${e.id}" ${e.id === state.selectedEmployee ? "selected" : ""}>${e.short} · ${e.code}</option>`).join("")}</select>`;
      $(".workspace-bar").insertBefore(wrapper, $(".role-picker"));
    }
    sidebar(page);
    const views = {
      connection: connectionView,
      bot: botView,
      employees: employeesView,
      "employees/link": () => employeeLinkView(id || "e2"),
      cards: cardsView,
      "cards/edit": () => cardEditView(id || "meeting"),
      send: () => sendView(id || "meeting"),
      tracking: trackingView,
      "tracking/detail": () => trackingDetailView(id || "p1"),
      "employee/home": employeeHomeView,
      "employee/chat": chatView,
      "employee/profile": employeeProfileView,
      "employee/link": () => bindingView(id || state.selectedEmployee),
      "employee/message": () => messageView(id || "p1"),
      inbox: () => inboxView(id),
      flow: flowView,
    };
    $("#main").innerHTML = (views[page] || notFound)();
    if (page === "tracking/detail") {
      const p = publication(id || "p1");
      if (p?.recipients.some((r) => r.delivery === "quiet"))
        $("#main").insertAdjacentHTML(
          "beforeend",
          `<div style="margin-top:20px">${notice("การแจ้งเตือน LINE อยู่ในเวลาเงียบ พนักงานยังอ่านข้อความในแอปได้ " + btn("จำลองสิ้นสุดเวลาเงียบ", "release-quiet", `data-id="${p.id}"`, "quiet"))}</div>`,
        );
    }
    document.title = `${$("#main h1")?.textContent || "LINE พนักงาน"} · Industrial SAS Preview`;
    if ($("#link-qr") && window.qrcode) {
      const qr = window.qrcode(0, "M");
      qr.addData(linkUrl(id || "e2"));
      qr.make();
      $("#link-qr").innerHTML = qr.createImgTag(
        4,
        0,
        "QR เชื่อม LINE ใน preview",
      );
    }
    if (focus) {
      window.scrollTo(0, 0);
      $("#main").focus({ preventScroll: true });
    }
    const nav = $("#sidebar nav"),
      selected = nav.querySelector(".active");
    if (selected && nav.scrollWidth > nav.clientWidth) {
      const n = nav.getBoundingClientRect(),
        s = selected.getBoundingClientRect();
      nav.scrollLeft += s.left - n.left - (n.width - s.width) / 2;
    }
    save();
  }
  function formError(text) {
    const out = $("#form-error");
    if (out) {
      out.textContent = text;
      out.style.color = "var(--red)";
    } else toast(text);
  }
  function draftForm(form) {
    const out = Object.fromEntries(new FormData(form));
    if (form.dataset.form === "bot")
      for (const key of ["correction", "clock", "holiday"])
        out[key] = form.elements[key].checked;
    if (form.dataset.form === "template") out.ack = form.elements.ack.checked;
    if (form.dataset.form === "publish")
      out.audience = [...form.querySelectorAll("[name=recipient]:checked")]
        .map((x) => x.value)
        .join(",");
    state.drafts[activeRoute] = out;
    dirty = true;
    save();
    return out;
  }
  function chat(text) {
    const e = employee();
    if (!bound(e)) return toast("เชื่อมบัญชีก่อนใช้ผู้ช่วย HR");
    if (!ready()) return toast("LINE ขัดข้องในตัวอย่าง ลองอ่านข้อมูลในแอปก่อน");
    const list = (state.chats[e.id] ||= []);
    list.push({ from: "employee", text });
    const thread = state.threads[e.id];
    if (thread && thread.mode !== "bot") {
      thread.messages.push({ from: "employee", text, time: "10:30" });
      if (thread.mode === "waiting")
        list.push({
          from: "bot",
          text: "ส่งข้อมูลเพิ่มเติมให้ HR แล้ว เจ้าหน้าที่จะรับช่วงตอบในบทสนทนานี้",
        });
    } else {
      let reply =
        "ฉันช่วยดูตารางงาน ผลคำขอแก้ไขเวลา และวันหยุดของคุณได้ หากต้องการเรื่องอื่น กดคุยกับเจ้าหน้าที่ HR";
      if (/ตาราง|กะ|ทำงาน/.test(text))
        reply = `${e.short} วันนี้คุณทำงานที่ ${e.site}\nเวลา ${e.id === "e3" ? "20:00–05:00 ของวันถัดไป" : "08:30–17:30"}\nข้อมูลนี้เป็นตัวอย่างของคุณคนเดียว`;
      if (/แก้ไข|คำขอ|แก้เวลา/.test(text))
        reply =
          "คำขอแก้ไขเวลาวันที่ 12 ต.ค. ของคุณได้รับการรับรองแล้ว\nเปิดหน้า HR → คำขอของฉัน เพื่อตรวจรายละเอียด";
      if (/วันหยุด/.test(text))
        reply = `วันหยุดถัดไปของ ${e.site} คือ 23 ต.ค.\nโปรดตรวจวันหยุดที่ HR ตั้งในระบบอีกครั้ง`;
      list.push({ from: "bot", text: reply });
    }
    save();
    render();
    $(".line-chat")?.scrollTo(0, $(".line-chat").scrollHeight);
  }
  async function acknowledge(button) {
    const e = employee(button.dataset.employee),
      p = publication(button.dataset.id),
      r = p?.recipients.find((r) => r.employee === e.id);
    if (
      e.id !== state.selectedEmployee ||
      !e.account ||
      !e.active ||
      !r ||
      !p.ack
    )
      return toast("บัญชีนี้ไม่มีสิทธิ์รับทราบข้อความนี้");
    if (button.dataset.channel === "line" && (!bound(e) || !ready()))
      return toast("การเชื่อม LINE ไม่พร้อม ลองรับทราบในแอป");
    if (p.state !== "published")
      return toast("ข้อความนี้ยกเลิกหรือยังไม่เผยแพร่แล้ว ไม่รับการยืนยันใหม่");
    if (r.ackAt) return toast("คุณรับทราบข้อความรุ่นนี้แล้ว ไม่มีการบันทึกซ้ำ");
    await operation(button, "กำลังบันทึก…", () => {
      r.ackAt = stamp();
      (state.chats[e.id] ||= []).push({
        from: "bot",
        text: `บันทึกการรับทราบแล้ว\n${p.title}\nข้อความรุ่น ${p.version} · ${r.ackAt}`,
      });
      render();
      toast("บันทึกการรับทราบแล้ว HR เห็นผลในหน้าติดตาม");
    });
  }
  async function submit(form, event) {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form)),
      kind = form.dataset.form,
      button = form.querySelector("[type=submit]");
    if (kind === "connection") {
      if (
        !/^\d{8,14}$/.test(data.channel) ||
        data.token.length < 8 ||
        data.secret.length < 8
      )
        return formError(
          "ตรวจ Channel ID และข้อมูลตัวอย่างอีกครั้ง ใช้ปุ่ม “ใช้ข้อมูลตัวอย่าง” เพื่อเริ่มได้",
        );
      return operation(button, "กำลังตรวจ…", () => {
        const c = state.connection;
        if (c.channel !== data.channel) {
          c.webhook = c.tested = c.active = false;
        }
        c.name = data.name.trim();
        c.channel = data.channel;
        c.credentials = true;
        c.outage = false;
        delete state.drafts[activeRoute];
        dirty = false;
        render();
        toast("ตรวจ credentials ตัวอย่างผ่านแล้ว");
      });
    }
    if (kind === "bot")
      return operation(button, "กำลังบันทึก…", () => {
        state.bot = {
          ...state.bot,
          ...data,
          correction: form.elements.correction.checked,
          clock: form.elements.clock.checked,
          holiday: form.elements.holiday.checked,
        };
        delete state.drafts[activeRoute];
        dirty = false;
        render();
        toast("บันทึกผู้ช่วยและการแจ้งเตือนแล้ว");
      });
    if (kind === "template") {
      const unknown = [
        ...data.body.matchAll(/\{\{(.*?)\}\}/g),
        ...data.title.matchAll(/\{\{(.*?)\}\}/g),
      ].find(
        (m) => !["employeeName", "siteName", "date", "time"].includes(m[1]),
      );
      if (unknown)
        return formError(
          `ไม่รู้จักตัวแปร {{${unknown[1]}}} เลือกตัวแปรจากรายการใต้เนื้อหา`,
        );
      if (form.elements.ack.checked && !data.label.trim())
        return formError("ใส่ข้อความบนปุ่มรับทราบก่อน");
      return operation(button, "กำลังบันทึก…", () => {
        const t = template(form.dataset.id);
        Object.assign(t, {
          title: data.title.trim(),
          body: data.body.trim(),
          label: data.label.trim(),
          ack: form.elements.ack.checked,
          version: t.version + 1,
        });
        delete state.drafts[activeRoute];
        dirty = false;
        busy = false;
        complete("cards");
        toast(
          "บันทึกแบบข้อความรุ่นใหม่แล้ว ข้อความที่ส่งก่อนหน้ายังเป็นรุ่นเดิม",
        );
      });
    }
    if (kind === "publish") {
      const recipients = new FormData(form).getAll("recipient");
      if (!recipients.length) return formError("เลือกพนักงานอย่างน้อยหนึ่งคน");
      if (
        data.when === "schedule" &&
        (!data.schedule || data.schedule <= "2026-10-13T10:30")
      )
        return formError(
          "เลือกเวลาที่อยู่หลัง 13 ต.ค. 2569 เวลา 10:30 ของตัวอย่าง",
        );
      const snapshot = { ...template(data.template) };
      return openDialog(
        data.when === "schedule"
          ? "ตั้งเวลาส่งข้อความนี้?"
          : "ส่งข้อความนี้ให้พนักงาน?",
        `${escape(snapshot.title)} · รุ่น ${snapshot.version}<br>ผู้รับ ${recipients.length} คน · ${snapshot.ack ? "ต้องกดรับทราบ" : "แจ้งอย่างเดียว"}<br>${data.when === "schedule" ? `เวลาส่ง ${escape(data.schedule.replace("T", " "))}` : "ผู้รับจะเห็นข้อความนี้ในแอปทันที"}`,
        [
          { label: "กลับไปตรวจสอบ", run: () => {} },
          {
            label:
              data.when === "schedule" ? "ยืนยันตั้งเวลา" : "ยืนยันส่งข้อความ",
            primary: true,
            run: async () => {
              const currentButton = $(
                "#main [data-form=publish] [type=submit]",
              );
              if (!currentButton) return;
              await operation(currentButton, "กำลังส่ง…", () => {
                const id = `p${state.nextId++}`;
                const p = {
                  ...snapshot,
                  id,
                  template: snapshot.id,
                  state: data.when === "schedule" ? "scheduled" : "published",
                  schedule: data.schedule,
                  at: stamp(),
                  recipients: recipients.map((employeeId) => {
                    const e = employee(employeeId);
                    return {
                      employee: employeeId,
                      delivery:
                        data.when === "schedule" ? "scheduled" : deliveryFor(e),
                      opened: false,
                      ackAt: null,
                      reminders: 0,
                    };
                  }),
                };
                state.publications.push(p);
                delete state.drafts[activeRoute];
                dirty = false;
                busy = false;
                navigate(`tracking/detail?id=${id}`, true, true);
                toast(
                  p.state === "scheduled"
                    ? "ตั้งเวลาส่งแล้ว ยังไม่แสดงในมุมพนักงาน"
                    : "เผยแพร่ข้อความในตัวอย่างแล้ว",
                );
              });
            },
          },
        ],
      );
    }
    if (kind === "bind") {
      const e = employee(form.dataset.id),
        inv = state.invitations[e.id];
      if (!ready()) return formError("ช่องทาง LINE ยังไม่พร้อม");
      if (!inv?.friend) return formError("เพิ่มเพื่อน OA ก่อนยืนยัน");
      if (inv.expired || Date.now() > inv.expiresAt)
        return formError(
          "คำเชิญหมดอายุ สร้างคำเชิญใหม่ด้านล่างแล้วลองอีกครั้ง",
        );
      if (data.actor !== e.id)
        return formError(
          "บัญชีที่เข้าสู่ระบบไม่ตรงกับพนักงานในคำเชิญ เปลี่ยนเป็นบัญชีของคุณก่อน",
        );
      return operation(button, "กำลังยืนยัน…", () => {
        if (!e.account || !e.active)
          return formError("บัญชีพนักงานไม่พร้อมใช้งาน ให้ HR ตรวจสถานะ");
        e.line = "connected";
        inv.used = true;
        state.selectedEmployee = e.id;
        busy = false;
        navigate(`employee/chat?id=${e.id}`, true, true);
        toast("เชื่อมบัญชีสำเร็จ ได้รับผู้ช่วย HR เริ่มต้นแล้ว");
      });
    }
    if (kind === "chat") {
      if (data.message.trim()) {
        if (bound(employee()) && ready()) {
          state.chatDrafts ||= {};
          state.chatDrafts[state.selectedEmployee] = "";
        }
        chat(data.message.trim());
      }
      return;
    }
    if (kind === "hr-reply") {
      const e = employee(form.dataset.id),
        t = state.threads[e.id];
      if (!data.message.trim() || !t || t.mode !== "human") return;
      if (!bound(e) || !ready())
        return toast("LINE ของพนักงานส่งถึงไม่ได้ กรุณาตรวจการเชื่อมต่อก่อน");
      t.messages.push({ from: "hr", text: data.message.trim(), time: "10:30" });
      (state.chats[e.id] ||= []).push({
        from: "hr",
        text: data.message.trim(),
      });
      state.hrDrafts ||= {};
      state.hrDrafts[e.id] = "";
      save();
      render();
      toast("ส่งคำตอบตัวอย่างแล้ว เปิดมุมพนักงานเพื่อดูข้อความได้");
    }
  }
  function deliveryFor(e) {
    return !e.active || !e.account
      ? "failed"
      : !e.notifications
        ? "paused"
        : e.line === "blocked"
          ? "blocked"
          : e.line !== "connected"
            ? "unlinked"
            : !ready()
              ? "failed"
              : inQuietHours()
                ? "quiet"
                : "accepted";
  }
  function inQuietHours() {
    const minutes = (value) => {
      const [hour, minute] = value.split(":").map(Number);
      return hour * 60 + minute;
    };
    const start = minutes(state.bot.quietStart),
      end = minutes(state.bot.quietEnd),
      current = 10 * 60 + 30;
    return start === end
      ? false
      : start < end
        ? current >= start && current < end
        : current >= start || current < end;
  }
  function modalReset(scenario = "ready") {
    openDialog(
      "เริ่มข้อมูลตัวอย่างใหม่?",
      "ข้อมูลที่ลองแก้และส่งใน preview นี้จะถูกรีเซ็ต ไม่มีผลกับระบบจริง",
      [
        {
          label: "ใช้ข้อมูลปัจจุบันต่อ",
          run: () => {
            $("#scenario").value = state.scenario;
          },
        },
        {
          label: "เริ่มใหม่",
          primary: true,
          run: () => {
            state = seed(scenario);
            dirty = false;
            save();
            navigate("connection", true, true);
            toast("เริ่มข้อมูลตัวอย่างใหม่แล้ว");
          },
        },
      ],
    );
  }
  async function action(button) {
    const a = button.dataset.action,
      id = button.dataset.id;
    if (busy && a !== "theme") return toast("กำลังบันทึก โปรดรอสักครู่");
    if (a === "dialog-choice")
      return closeDialog(
        $("#dialog")._choices[Number(button.dataset.choice)]?.run,
      );
    if (a === "reset") return modalReset(state.scenario);
    if (a === "return-page") return cancel(button.dataset.parent);
    if (a === "theme") {
      state.theme = state.theme === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = state.theme;
      $("#theme-icon").innerHTML = icon(
        state.theme === "dark" ? "sun" : "moon",
      );
      save();
      return;
    }
    if (a === "role")
      return navigate(
        button.dataset.role === "hr" ? "employees" : "employee/home",
      );
    if (a === "sample-credentials") {
      const form = $("[data-form=connection]");
      form.elements.token.value = "DEMO-ACCESS-TOKEN";
      form.elements.secret.value = "DEMO-CHANNEL-SECRET";
      form.elements.channel.value = "2001234567";
      draftForm(form);
      return toast("ใส่ข้อมูลตัวอย่างแล้ว กดตรวจการเชื่อมต่อได้");
    }
    if (a === "webhook")
      return openDialog(
        "ตั้ง webhook ของช่องทาง",
        "ในระบบจริงคัดลอก URL ไปตั้งใน LINE Developers แล้วเปิด Use webhook<br><code>/webhooks/line/demo-connection</code><br>ปุ่มด้านล่างจำลองการรับ signed webhook สำเร็จ",
        [
          { label: "กลับ", run: () => {} },
          {
            label: "จำลองว่าเปิด webhook แล้ว",
            primary: true,
            run: () => {
              state.connection.webhook = true;
              save();
              render();
              toast("ตรวจ webhook ตัวอย่างผ่านแล้ว");
            },
          },
        ],
      );
    if (a === "test-connection")
      return operation(button, "กำลังทดสอบ…", () => {
        if (state.connection.outage)
          return toast("ทดสอบไม่ผ่านในสถานการณ์ LINE ขัดข้อง");
        state.connection.tested = true;
        save();
        render();
        toast("จำลองรับและตอบข้อความทดสอบสำเร็จ");
      });
    if (a === "activate") {
      state.connection.active = !state.connection.active;
      save();
      render();
      return toast(
        state.connection.active
          ? "เปิด LINE พนักงานในตัวอย่างแล้ว"
          : "พักการส่ง LINE แล้ว ข้อความในแอปยังอยู่",
      );
    }
    if (a === "assign-bot") {
      const e = employee(id);
      return openDialog(
        `ผู้ช่วย HR ของ${e.short}`,
        "เลือกตามค่าเริ่มต้นองค์กร หรือกำหนดผู้ช่วยเฉพาะพนักงานคนนี้",
        [
          {
            label: `ตามองค์กร · ${bots[state.bot.default]}`,
            primary: true,
            run: () => {
              e.bot = "default";
              save();
              render();
              toast("ใช้ผู้ช่วยตามค่าเริ่มต้นองค์กรแล้ว");
            },
          },
          ...Object.entries(bots).map(([key, name]) => ({
            label: name,
            run: () => {
              e.bot = key;
              save();
              render();
              toast("เปลี่ยนผู้ช่วยของพนักงานแล้ว");
            },
          })),
          { label: "ยกเลิก", run: () => {} },
        ],
      );
    }
    if (a === "member-link") {
      const e = employee(id);
      return openDialog(
        "เชื่อมบัญชีสมาชิกก่อนใช้ HR",
        `ยืนยันบัญชีสมาชิกตัวอย่างของ ${escape(e.name)} ให้ตรงกับ ${e.code}`,
        [
          { label: "ยกเลิก", run: () => {} },
          {
            label: "เชื่อมสมาชิกตัวอย่าง",
            primary: true,
            run: () => {
              e.account = true;
              save();
              render();
              toast("เชื่อมบัญชีสมาชิกแล้ว เริ่มเชื่อม LINE ได้");
            },
          },
        ],
      );
    }
    if (a === "copy-link") {
      try {
        await navigator.clipboard.writeText(linkUrl(id));
        toast("คัดลอกลิงก์แล้ว");
      } catch {
        openDialog("ลิงก์เชื่อมบัญชี", escape(linkUrl(id)), [
          { label: "ปิด", run: () => {} },
        ]);
      }
      return;
    }
    if (a === "invite-renew") {
      state.invitations[id] = {
        expired: false,
        friend: false,
        used: false,
        expiresAt: Date.now() + 10 * 60 * 1000,
      };
      if (employee(id).line !== "connected") employee(id).line = "pending";
      save();
      render();
      return toast("สร้างคำเชิญใหม่แล้ว เริ่มเชื่อมได้");
    }
    if (a === "invite-cancel") {
      delete state.invitations[id];
      employee(id).line = "unlinked";
      save();
      complete("employees");
      return toast("ยกเลิกคำเชิญแล้ว");
    }
    if (a === "friend") {
      const inv = (state.invitations[id] ||= { expired: false });
      inv.friend = true;
      save();
      render();
      return;
    }
    if (a === "expire-invite") {
      const inv = (state.invitations[id] ||= { friend: false });
      inv.expired = true;
      save();
      toast("คำเชิญหมดอายุแล้ว ลองยืนยันเพื่อดูข้อผิดพลาด");
      return;
    }
    if (a === "unlink") {
      const e = employee(id);
      return openDialog(
        "ยกเลิกการเชื่อม LINE?",
        "หยุดผู้ช่วยและแจ้งเตือนผ่าน LINE ของบัญชีนี้ ข้อมูล HR และข้อความในแอปยังอยู่",
        [
          { label: "เชื่อมต่อไว้", run: () => {} },
          {
            label: "ยกเลิกการเชื่อม",
            danger: true,
            run: () => {
              e.line = "unlinked";
              delete state.invitations[e.id];
              save();
              render();
              toast("ยกเลิกการเชื่อมแล้ว");
            },
          },
        ],
      );
    }
    if (a === "cancel-edit") return cancel(button.dataset.parent);
    if (a === "preview-ack") {
      const container = button.closest(".line-chat");
      if (!container.querySelector("[data-preview-receipt]"))
        container.insertAdjacentHTML(
          "beforeend",
          `<div data-preview-receipt>${lineText("ตัวอย่าง: บันทึกการรับทราบแล้ว\nไม่มีการส่งหรือบันทึกให้พนักงานจริง")}</div>`,
        );
      container.scrollTo(0, container.scrollHeight);
      return;
    }
    if (a === "preview-detail")
      return openDialog(
        "ตัวอย่างหน้ารายละเอียด",
        "เมื่อส่งจริง ปุ่มนี้จะเปิดข้อความรุ่นที่ส่งให้พนักงานคนนั้น และตรวจสิทธิ์ก่อนแสดง",
        [{ label: "ปิด", run: () => {} }],
      );
    if (a === "ack") return acknowledge(button);
    if (a === "message-detail") return navigate(`employee/message?id=${id}`);
    if (a === "quick-chat") return chat(button.dataset.text);
    if (a === "handoff") {
      const e = employee();
      if (!bound(e)) return toast("เชื่อมบัญชีพนักงานก่อน");
      const t = state.threads[e.id];
      if (t && t.mode !== "bot") return toast("เรื่องนี้ส่งถึง HR แล้ว");
      state.threads[e.id] = {
        employee: e.id,
        mode: "waiting",
        messages: [
          {
            from: "employee",
            text: "ขอสอบถามเรื่อง HR เพิ่มเติมครับ",
            time: "10:30",
          },
        ],
      };
      (state.chats[e.id] ||= []).push({
        from: "bot",
        text: "ส่งเรื่องให้เจ้าหน้าที่ HR แล้ว\nคุณส่งรายละเอียดเพิ่มเติมในแชทนี้ได้",
      });
      save();
      render();
      return;
    }
    if (a === "thread-mode") {
      const t = state.threads[id];
      t.mode = t.mode === "human" ? "bot" : "human";
      (state.chats[id] ||= []).push({
        from: t.mode === "human" ? "hr" : "bot",
        text:
          t.mode === "human"
            ? "พัชราภา HR รับช่วงดูแลแล้วค่ะ สอบถามเพิ่มเติมได้เลย"
            : "HR คืนเรื่องให้ผู้ช่วยแล้ว คุณถามข้อมูล HR พื้นฐานต่อได้",
      });
      save();
      render();
      return;
    }
    if (a === "remind") {
      const p = publication(id),
        pending = p.recipients.filter((r) => !r.ackAt);
      if (!pending.length) return toast("ทุกคนรับทราบแล้ว ไม่ต้องส่งเตือน");
      if (pending.every((r) => r.reminders > 0))
        return toast("ส่งเตือนรอบนี้แล้ว ไม่มีการส่งซ้ำ");
      return operation(button, "กำลังส่งเตือน…", () => {
        for (const r of pending)
          if (!r.reminders) {
            r.reminders = 1;
            r.delivery = deliveryFor(employee(r.employee));
          }
        render();
        const accepted = pending.filter(
          (r) => r.delivery === "accepted",
        ).length;
        toast(
          `สร้างรายการเตือน ${pending.length} คน · LINE รับคำขอ ${accepted} คน · คนที่ยืนยันไม่ถูกเตือน`,
        );
      });
    }
    if (a === "run-scheduled")
      return operation(button, "กำลังเผยแพร่…", () => {
        const p = publication(id);
        p.state = "published";
        p.at = p.schedule.replace("T", " ") + " · เวลาจำลอง";
        p.recipients.forEach((r) => {
          r.delivery = deliveryFor(employee(r.employee));
        });
        render();
        toast("ถึงเวลาส่งตัวอย่างแล้ว พนักงานเห็นข้อความในแอป");
      });
    if (a === "withdraw")
      return openDialog(
        "ยกเลิกข้อความนี้?",
        "หยุดการยืนยันใหม่ และเก็บประวัติการรับทราบเดิม LINE Card ที่ส่งไปแล้วจะยังอยู่ แต่ปุ่มยืนยันจะบอกว่าข้อความถูกยกเลิก",
        [
          { label: "เก็บไว้", run: () => {} },
          {
            label: "ยกเลิกข้อความ",
            danger: true,
            run: () => {
              publication(id).state = "withdrawn";
              save();
              render();
              toast("ยกเลิกข้อความแล้ว");
            },
          },
        ],
      );
    if (a === "notification-toggle") {
      employee().notifications = button.checked;
      save();
      toast(
        button.checked
          ? "เปิดรับการแจ้งเตือน LINE แล้ว"
          : "ปิดแจ้งเตือน LINE แล้ว ยังอ่านข้อความในแอปได้",
      );
    }
    if (a === "notify-event") {
      if (dirty) return toast("บันทึกการตั้งค่าก่อนลองเหตุการณ์");
      const kind = button.dataset.kind,
        e = employee();
      if (!state.bot[kind]) return toast("เปิดแจ้งเตือนประเภทนี้และบันทึกก่อน");
      if (!e.account || !e.active)
        return toast("พนักงานยังไม่มีบัญชีสมาชิกที่พร้อมใช้งาน");
      const key = `${kind}:${e.id}:sample-event-v1`;
      state.notificationEvents ||= {};
      if (state.notificationEvents[key])
        return toast("เหตุการณ์ตัวอย่างนี้แจ้งแล้ว ไม่มีการส่งซ้ำ");
      const snapshot = { ...template(kind === "holiday" ? "clock" : kind) };
      if (kind === "holiday")
        Object.assign(snapshot, {
          kind: "วันหยุดของไซต์",
          title: "วันหยุดถัดไปของคุณ",
          body: "คุณ {{employeeName}}\nวันที่ 23 ต.ค. เป็นวันหยุดของ {{siteName}}\nตรวจวันหยุดและตารางงานของคุณในระบบ HR",
        });
      const id = `p${state.nextId++}`;
      state.publications.push({
        ...snapshot,
        id,
        template: snapshot.id,
        state: "published",
        at: stamp(),
        schedule: "",
        recipients: [
          {
            employee: e.id,
            delivery: deliveryFor(e),
            opened: false,
            ackAt: null,
            reminders: 0,
          },
        ],
      });
      state.notificationEvents[key] = id;
      save();
      navigate(`tracking/detail?id=${id}`);
      toast("สร้างข้อความตามเหตุการณ์ HR แล้ว");
    }
    if (a === "release-quiet") {
      const p = publication(id);
      for (const r of p.recipients)
        if (r.delivery === "quiet") {
          const e = employee(r.employee);
          const result = deliveryFor(e);
          r.delivery = result === "quiet" ? "accepted" : result;
        }
      save();
      render();
      toast("จำลองสิ้นสุดเวลาเงียบแล้ว ตรวจสิทธิ์และการเชื่อมก่อนส่ง");
    }
  }
  document.addEventListener("click", (event) => {
    const routeTarget = event.target.closest("[data-route]");
    if (routeTarget) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      event.preventDefault();
      return navigate(routeTarget.dataset.route);
    }
    const target = event.target.closest("[data-action]");
    if (target)
      action(target).catch((error) => {
        console.error(error);
        toast("ทำรายการตัวอย่างไม่สำเร็จ ลองอีกครั้ง");
      });
  });
  document.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-form]");
    if (form)
      submit(form, event).catch((error) => {
        console.error(error);
        busy = false;
        toast("ทำรายการตัวอย่างไม่สำเร็จ ลองอีกครั้ง");
      });
  });
  document.addEventListener("input", (event) => {
    if (event.target.id === "employee-search") {
      const q = event.target.value.trim().toLowerCase();
      document.querySelectorAll("[data-employee-row]").forEach((row) => {
        row.hidden = !row.dataset.search.includes(q);
      });
      return;
    }
    const form = event.target.closest("[data-form]");
    if (form?.dataset.form === "chat") {
      state.chatDrafts ||= {};
      state.chatDrafts[state.selectedEmployee] = event.target.value;
      save();
      return;
    }
    if (form?.dataset.form === "hr-reply") {
      state.hrDrafts ||= {};
      state.hrDrafts[form.dataset.id] = event.target.value;
      save();
      return;
    }
    if (
      !form ||
      !["connection", "bot", "template", "publish"].includes(form.dataset.form)
    )
      return;
    const d = draftForm(form);
    if (form.dataset.form === "template")
      $("#live-card-preview").innerHTML = phone(
        flex({ ...template(form.dataset.id), ...d }, employee(), {
          preview: true,
        }),
      );
    if (form.dataset.form === "publish") {
      $("#schedule-field").hidden = d.when !== "schedule";
      const ids = d.audience.split(",").filter(Boolean);
      $("#send-summary").textContent =
        `${ids.length} คน · ${template(d.template).ack ? "ต้องกดรับทราบ" : "แจ้งอย่างเดียว"} · ข้อความรุ่น ${template(d.template).version}`;
    }
  });
  document.addEventListener("change", (event) => {
    if (event.target.id === "scenario") return modalReset(event.target.value);
    if (event.target.id === "employee-select") {
      state.selectedEmployee = event.target.value;
      save();
      navigate(`employee/home?id=${event.target.value}`);
    }
    if (event.target.id === "send-template") {
      const d = state.drafts[activeRoute];
      dirty = false;
      const next = `send?id=${event.target.value}`;
      if (d) {
        state.drafts[next] = d;
        delete state.drafts[activeRoute];
      }
      navigate(next, true, true);
    }
  });
  $("#dialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog();
  });
  window.addEventListener("popstate", () => {
    if ($("#dialog").open) {
      $("#dialog").close();
      const fn = dialogAction;
      dialogAction = null;
      if (dialogFocus?.isConnected) dialogFocus.focus();
      if (fn) fn();
      return;
    }
    if (rollback) {
      rollback = false;
      return;
    }
    const target = routeData().route;
    if (target !== activeRoute && (dirty || busy)) {
      const from = activeRoute;
      rollback = true;
      history.go(1);
      if (busy) return toast("กำลังบันทึก โปรดรอให้เสร็จก่อนกลับ");
      setTimeout(
        () =>
          openDialog(
            "ยังมีการแก้ไขที่ไม่ได้บันทึก",
            "กลับไปทำต่อ หรือทิ้งการแก้ไขก่อนย้อนกลับ",
            [
              { label: "ทำต่อ", run: () => {} },
              {
                label: "ทิ้งและย้อนกลับ",
                danger: true,
                run: () => {
                  delete state.drafts[from];
                  dirty = false;
                  save();
                  history.back();
                },
              },
            ],
          ),
        80,
      );
      return;
    }
    render(true);
  });
  window.addEventListener("beforeunload", (event) => {
    if (busy || dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  if (!location.hash.startsWith("#/"))
    history.replaceState({ previewIndex: 0 }, "", "#/connection");
  else if (!history.state?.previewIndex)
    history.replaceState({ previewIndex: 0 }, "", location.href);
  render();
})();
