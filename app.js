/* ====== CONFIG ====== */
const DATASET_URL = "dataset-ntdl.json";     // đặt đúng tên file JSON của bạn
const IMG_DIR = "nonenametag";         // thư mục ảnh .jpg

/* ====== STATE ====== */
const st = {
  raw: [],
  filteredBrowse: [],
  filteredLearn: [],
  selectedKeys: new Set(), // key = stt

  // học (flashcard)
  learn: [],
  idx: 0,
  show: false,

  // thi (tự luận - nộp 1 lần)
  exam: { items: [], idx: 0, answers: {}, timer: null, timeLeft: 0, on: false, submitted: false },

  // scan ảnh
  imgScan: { ok: 0, total: 0, missing: [] }
};

/* ====== HELPERS ====== */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const byId = (id) => document.getElementById(id);
const norm = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();

/* Encode từng đoạn để tránh lỗi dấu + khoảng trắng */
function safeURL(p){
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p;
  return p.split("/").map(encodeURIComponent).join("/");
}

/* Tạo danh sách đường dẫn dự phòng theo các đuôi ảnh thường gặp */
function guessPaths(item){
  let p = item.image || (item.image_code ? `${IMG_DIR}/${item.image_code}` : "");
  if (!p){
    const base = norm(item.vn).replace(/[^a-z0-9]/g,"");
    p = `${IMG_DIR}/${base}.jpg`;
  }
  const dot = p.lastIndexOf(".");
  const base = dot>0 ? p.slice(0,dot) : p;
  return [".jpg",".jpeg",".JPG",".png"].map(ext => `${base}${ext}`);
}

/* Global onerror fallback cho <img> */
window.__imgOnErr = function(img){
  const left = (img.dataset.alt||"").split("|").filter(Boolean);
  if (left.length){
    const next = left.shift();
    img.dataset.alt = left.join("|");
    img.src = safeURL(next);
  } else {
    img.onerror = null;
  }
};

/* Try load 1 ảnh; resolve {ok, url, tried} */
function tryLoadImage(paths){
  return new Promise((resolve)=>{
    let i = 0; const img = new Image();
    const go = () => { if (i>=paths.length) return resolve({ok:false,url:null,tried:paths}); img.src = safeURL(paths[i]); };
    img.onload = () => resolve({ok:true,url:paths[i],tried:paths.slice(0,i+1)});
    img.onerror = () => { i++; go(); };
    go();
  });
}

/* ====== BOOT ====== */
window.addEventListener("DOMContentLoaded", async () => {
  await loadData();
  buildBrowse();
  buildLearn();
  bindTabs();
  scanImages(false);
});

/* ====== LOAD ====== */
async function loadData(){
  const res = await fetch(DATASET_URL);
  const js = await res.json();
  st.raw = (js.items||[]).slice();     // giữ nguyên thứ tự JSON
  st.filteredBrowse = st.raw.slice();
  st.filteredLearn  = st.raw.slice();
}

/* ====== TABS ====== */
function bindTabs(){
  const tabBrowse = byId("tabBrowse");
  const tabLearn  = byId("tabLearn");
  function sync(){
    byId("pageBrowse").classList.toggle("on", tabBrowse.checked);
    byId("pageLearn").classList.toggle("on", tabLearn.checked);
  }
  tabBrowse.addEventListener("change", sync);
  tabLearn .addEventListener("change", sync);
  sync();

  byId("imgStatus").addEventListener("click", ()=> showMissing());
  byId("btnScan").addEventListener("click", ()=> scanImages(true));
  byId("closeDiag").addEventListener("click", ()=> byId("diagMissing").close());
}

/* ====== TRA CỨU ====== */
function buildBrowse(){
  const q = byId("qBrowse");
  byId("btnClearBrowse").addEventListener("click", ()=>{ q.value=""; applyBrowse(); });
  q.addEventListener("input", applyBrowse);
  applyBrowse();
}
function applyBrowse(){
  const q = byId("qBrowse").value.trim();
  st.filteredBrowse = q
    ? st.raw.filter(it =>
        norm(it.vn).includes(norm(q)) || norm(it.en).includes(norm(q)) ||
        norm(it.family).includes(norm(q)) || norm(it.constituents).includes(norm(q)) ||
        norm(it.uses).includes(norm(q))
      )
    : st.raw.slice();
  renderBrowse();
}
function renderBrowse(){
  const host = byId("browseList");
  host.innerHTML = "";
  st.filteredBrowse.forEach(it=>{
    const paths = guessPaths(it);
    const dataAlt = paths.slice(1).join("|");
    const first = safeURL(paths[0]);
    const el = document.createElement("div");
    el.className = "cardBox";
    el.innerHTML = `
      <div class="pic">
        <img src="${first}" alt="${it.vn}" data-alt="${dataAlt}" onerror="__imgOnErr(this)"/>
      </div>
      <div><b>${it.stt}. ${it.vn}</b></div>
      <div class="metaKV">${it.en||"—"} · [${it.family||"—"}]</div>
      <div><b>Bộ phận dùng:</b> ${it.parts||"—"}</div>
      <div><b>TPHH:</b> ${it.constituents||"—"}</div>
      <div><b>Công dụng:</b> ${it.uses||"—"}</div>
    `;
    host.appendChild(el);
  });
}

/* ====== HỌC (FLASHCARD) & THI (TỰ LUẬN) ====== */
function buildLearn(){
  const q = byId("qLearn");
  byId("btnClearLearn").addEventListener("click", ()=>{ q.value=""; applyLearnFilter(); });
  q.addEventListener("input", applyLearnFilter);
  applyLearnFilter();

  byId("btnSelectAll").addEventListener("click", ()=>{ st.filteredLearn.forEach(it=>st.selectedKeys.add(it.stt)); renderLearnList(); });
  byId("btnUnselect").addEventListener("click", ()=>{ st.selectedKeys.clear(); renderLearnList(); });

  byId("btnPickRange").addEventListener("click", ()=>{
    const a = Number(byId("sttFrom").value||"0");
    const b = Number(byId("sttTo").value||"0");
    if (!a || !b || a>b) return;
    st.raw.forEach(it=>{ if (it.stt>=a && it.stt<=b) st.selectedKeys.add(it.stt); });
    renderLearnList();
  });

  byId("btnStartAll").addEventListener("click", ()=> startLearn(st.filteredLearn));
  byId("btnStartSelected").addEventListener("click", ()=>{
    const pick = st.raw.filter(it=>st.selectedKeys.has(it.stt));
    startLearn(pick.length? pick : st.filteredLearn);
  });
  byId("btnLearnRange").addEventListener("click", ()=>{
    const a = Number(byId("sttFrom").value||"0");
    const b = Number(byId("sttTo").value||"0");
    if (!a || !b || a>b) return;
    startLearn(st.raw.filter(it=>it.stt>=a && it.stt<=b));
  });

  // THI 10 câu tự luận (nộp 1 lần)
  byId("btnExam10").addEventListener("click", ()=>{
    let pool = st.raw;
    const picked = st.raw.filter(it=>st.selectedKeys.has(it.stt));
    if (picked.length) pool = picked;
    else if (byId("qLearn").value.trim()) pool = st.filteredLearn;

    startExam(sample(pool, 10)); // 10 câu, 10 phút, nộp 1 lần
  });

  // Nav / Show / Submit (submit = nộp toàn bộ)
  byId("btnNext").addEventListener("click", ()=> move(+1));
  byId("btnPrev").addEventListener("click", ()=> move(-1));
  byId("btnShow").addEventListener("click", ()=>{
    if (st.exam.on) return; // trong thi không dùng nút này
    st.show = !st.show; renderLearnCard();
  });
  byId("btnSubmit").addEventListener("click", submitExamAll);
}
function applyLearnFilter(){
  const q = byId("qLearn").value.trim();
  st.filteredLearn = q
    ? st.raw.filter(it =>
        norm(it.vn).includes(norm(q)) || norm(it.en).includes(norm(q)) ||
        norm(it.family).includes(norm(q)) || norm(it.constituents).includes(norm(q)) ||
        norm(it.uses).includes(norm(q))
      )
    : st.raw.slice();
  renderLearnList();
}
function renderLearnList(){
  const host = byId("list");
  host.innerHTML = "";
  st.filteredLearn.forEach(it=>{
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <input type="checkbox" ${st.selectedKeys.has(it.stt)?'checked':''} aria-label="chọn">
      <div class="stt">${String(it.stt).padStart(2,"0")}</div>
      <div class="name">
        <b>${it.vn}</b>
        <span class="fam">[${it.family||"—"}]</span>
      </div>`;
    row.querySelector('input').addEventListener('change',e=>{
      if (e.target.checked) st.selectedKeys.add(it.stt);
      else st.selectedKeys.delete(it.stt);
    });
    row.addEventListener('dblclick', ()=> startLearn([it])); // học nhanh 1 cây
    host.appendChild(row);
  });
}

/* ===== HỌC ===== */
function startLearn(arr){
  // tắt thi nếu đang thi
  stopExamTimer();
  st.exam = { items: [], idx: 0, answers:{}, timer:null, timeLeft:0, on:false, submitted:false };

  if (!arr || !arr.length){
    byId("card").innerHTML = `<div class="placeholder">(Không có mục nào)</div>`;
    byId("counter").textContent = "—";
    byId("btnSubmit").classList.add("hide");
    byId("btnShow").classList.remove("hide");
    return;
  }
  st.learn = arr.slice(); // GIỮ THỨ TỰ
  st.idx = 0; st.show = false;
  byId("tabLearn").checked = true; byId("tabLearn").dispatchEvent(new Event("change"));
  byId("btnSubmit").classList.add("hide"); // không dùng trong học
  byId("btnShow").classList.remove("hide");
  renderLearnCard();
}
function move(step){
  if (st.exam.on){
    const L = st.exam.items.length; if (!L) return;
    st.exam.idx = (st.exam.idx + step + L) % L; renderExamCard();
  } else {
    const L = st.learn.length; if (!L) return;
    st.idx = (st.idx + step + L) % L; st.show = false; renderLearnCard();
  }
}
function renderLearnCard(){
  if (!st.learn.length){
    byId("card").innerHTML = `<div class="placeholder">(Chưa bắt đầu)</div>`;
    byId("counter").textContent = "—";
    return;
  }
  const it = st.learn[st.idx];
  byId("counter").textContent = `${st.idx+1}/${st.learn.length}`;
  const paths = guessPaths(it);
  const dataAlt = paths.slice(1).join("|");
  const first = safeURL(paths[0]);

  // Lưu ý: ban đầu chỉ hiện ẢNH. Nhấn "Hiện đáp án" mới lộ toàn bộ (kể cả tên Việt)
  byId("card").innerHTML = `
    <div class="fig">
      <div class="pic"><img src="${first}" alt="plant" data-alt="${dataAlt}" onerror="__imgOnErr(this)"></div>
      <div class="meta">
        ${st.show ? `
          <div><span class="badge">Tên Việt</span><div><b>${it.vn}</b></div></div>
          <div class="qa" style="margin-top:6px">
            <div><b>Latin:</b> ${it.en||"—"} · [${it.family||"—"}]</div>
            <div><b>Bộ phận dùng:</b> ${it.parts||"—"}</div>
            <div><b>TPHH:</b> ${it.constituents||"—"}</div>
            <div><b>Công dụng:</b> ${it.uses||"—"}</div>
          </div>
        ` : `<div class="muted">Bấm “Hiện đáp án” để xem toàn bộ thông tin.</div>`}
      </div>
    </div>
  `;
}

/* ===== THI (TỰ LUẬN — NỘP 1 LẦN) ===== */
function startExam(items){
  if (!items || !items.length) return;
  stopExamTimer();
  st.exam = { items: items.slice(), idx: 0, answers: {}, timer: null, timeLeft: 600, on: true, submitted: false }; // 10 phút
  byId("btnShow").classList.add("hide");
  byId("btnSubmit").classList.remove("hide");
  byId("btnSubmit").textContent = "Nộp bài";
  byId("tabLearn").checked = true; byId("tabLearn").dispatchEvent(new Event("change"));
  tickTimer(); st.exam.timer = setInterval(tickTimer, 1000);
  renderExamCard();
}
function stopExamTimer(){
  if (st.exam.timer){ clearInterval(st.exam.timer); st.exam.timer = null; }
}
function tickTimer(){
  if (!st.exam.on) return;
  byId("counter").textContent = `${st.exam.idx+1}/${st.exam.items.length} • ${fmtTime(st.exam.timeLeft)}`;
  st.exam.timeLeft--;
  if (st.exam.timeLeft < 0){
    // Hết giờ -> tự động nộp tất cả một lần
    submitExamAll(true);
  }
}
function fmtTime(s){ const m = Math.floor(Math.max(0,s)/60), ss = Math.max(0,s)%60; return `${m}:${String(ss).padStart(2,"0")}`; }

/* Lưu tạm câu trả lời khi nhập (để di chuyển qua lại không mất) */
function bindExamInputs(it){
  const key = it.stt;
  const form = byId("examForm");
  if (!form) return;
  form.querySelectorAll("[name]").forEach(el=>{
    el.addEventListener("input", e=>{
      const a = st.exam.answers[key] || (st.exam.answers[key] = { vn:"", en:"", fam:"", parts:"", tphh:"", uses:"" });
      a[e.target.name] = e.target.value;
    });
  });
}

function renderExamCard(){
  const it = st.exam.items[st.exam.idx];
  const key = it.stt;
  const ans = st.exam.answers[key] || { vn:"", en:"", fam:"", parts:"", tphh:"", uses:"" };
  const paths = guessPaths(it);
  const dataAlt = paths.slice(1).join("|");
  const first = safeURL(paths[0]);

  const disabled = st.exam.submitted || st.exam.timeLeft<0 ? "disabled" : "";
  const showAns = st.exam.submitted ? `
    <div class="ans">
      <div><b>Đáp án:</b></div>
      <div><b>Tên Việt:</b> ${it.vn||"—"}</div>
      <div><b>Latin:</b> ${it.en||"—"}</div>
      <div><b>Họ:</b> ${it.family||"—"}</div>
      <div><b>Bộ phận dùng:</b> ${it.parts||"—"}</div>
      <div><b>TPHH:</b> ${it.constituents||"—"}</div>
      <div><b>Công dụng:</b> ${it.uses||"—"}</div>
    </div>` : "";

  byId("card").innerHTML = `
    <div class="fig">
      <div class="pic"><img src="${first}" alt="exam" data-alt="${dataAlt}" onerror="__imgOnErr(this)"></div>
      <div class="meta">
        <div class="badge">Tự luận — điền đủ thông tin rồi bấm “Nộp bài”.</div>
        ${st.exam.submitted ? `<div class="badge" style="color:#a1f0b6">Đã nộp toàn bộ</div>` : ``}
        <form class="form" id="examForm">
          <label>Tên Việt<input ${disabled} name="vn" value="${escapeAttr(ans.vn)}" placeholder=""></label>
          <label>Tên Latin<input ${disabled} name="en" value="${escapeAttr(ans.en)}" placeholder=""></label>
          <label>Họ (family)<input ${disabled} name="fam" value="${escapeAttr(ans.fam)}" placeholder=""></label>
          <label>Bộ phận dùng<textarea ${disabled} name="parts" rows="2">${escapeText(ans.parts)}</textarea></label>
          <label>TPHH<textarea ${disabled} name="tphh" rows="2">${escapeText(ans.tphh)}</textarea></label>
          <label>Công dụng<textarea ${disabled} name="uses" rows="2">${escapeText(ans.uses)}</textarea></label>
        </form>
      </div>
    </div>
    ${showAns}
  `;

  byId("btnSubmit").disabled = !!disabled;
  bindExamInputs(it);
}

/* Nộp toàn bộ: khoá form + hiện đáp án mọi câu, tự lưu nếu còn đang dở */
function submitExamAll(auto=false){
  if (!st.exam.on) return;
  if (st.exam.submitted) return;
  // tự lưu lần cuối form đang mở
  const form = byId("examForm");
  const it = st.exam.items[st.exam.idx];
  if (form && it){
    const key = it.stt;
    const data = Object.fromEntries(new FormData(form).entries());
    st.exam.answers[key] = {
      vn: data.vn||"", en: data.en||"", fam: data.fam||"",
      parts: data.parts||"", tphh: data.tphh||"", uses: data.uses||""
    };
  }
  st.exam.submitted = true;
  st.exam.timeLeft = -1;
  stopExamTimer();
  byId("btnSubmit").disabled = true;
  byId("btnSubmit").textContent = auto ? "Đã tự nộp (hết giờ)" : "Đã nộp";
  renderExamCard(); // để khoá inputs & show đáp án cho câu hiện tại
}

/* ===== COMMON BUILDERS ===== */
function buildImgHTML(it){
  const paths = guessPaths(it);
  const dataAlt = paths.slice(1).join("|");
  const first = safeURL(paths[0]);
  return `<img src="${first}" alt="${it.vn}" data-alt="${dataAlt}" onerror="__imgOnErr(this)" />`;
}

/* ===== IMAGE SCAN ===== */
async function scanImages(showDialog){
  const results = await Promise.all(st.raw.map(async it=>{
    const paths = guessPaths(it);
    const res = await tryLoadImage(paths);
    return { stt:it.stt, vn:it.vn, ok:res.ok, url:res.url, tried:res.tried };
  }));
  const ok = results.filter(x=>x.ok).length;
  const miss = results.filter(x=>!x.ok);
  st.imgScan = { ok, total: results.length, missing: miss };
  byId("imgStatus").textContent = `Ảnh: ${ok}/${results.length}`; 
  byId("imgStatus").style.color = miss.length? "#ffb4b4" : "#a1f0b6";
  if (showDialog) showMissing();
}
function showMissing(){
  const dlg = byId("diagMissing");
  const body = byId("missBody");
  if (!st.imgScan.missing.length){
    body.innerHTML = `<div class="missItem">Tất cả ảnh đều đọc được ✓</div>`;
  } else {
    body.innerHTML = st.imgScan.missing.map(m=>`
      <div class="missItem">
        <b>${m.stt}. ${m.vn}</b><br>
        <div class="metaKV">Đã thử: ${m.tried.map(p=>`<code>${p}</code>`).join(" • ")}</div>
      </div>
    `).join("");
  }
  dlg.showModal();
}

/* ===== UTILS ===== */
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=(Math.random()*(i+1))|0; [a[i],a[j]]=[a[j],a[i]]} }
function sample(arr,n){ arr=arr.slice(); shuffle(arr); return arr.slice(0, Math.min(n, arr.length)); }
function escapeAttr(s){ return (s||"").replaceAll('"',"&quot;"); }
function escapeText(s){ return (s||""); }
