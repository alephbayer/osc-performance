import { useState, useEffect, useCallback, useRef } from "react";
import { db, resizeAndUpload } from "./supabase.js";

// ─── Brand ───────────────────────────────────────────────────────────────────
const B = {
  black:"#0a0a0a", gray900:"#111111", gray800:"#1a1a1a", gray700:"#2a2a2a",
  gray600:"#3d3d3d", gray500:"#555555", gray400:"#888888", gray200:"#d4d4d4",
  white:"#ffffff",
  orange:"#ff6b00", orangeD:"#cc5500", orangeL:"#ff8c33",
  blue:"#3b82f6",   blueD:"#1d4ed8",   blueBg:"rgba(59,130,246,.12)",
  green:"#16a34a",  greenBg:"rgba(22,163,74,.12)",
  amber:"#f59e0b",  amberBg:"rgba(245,158,11,.12)",
  purple:"#8b5cf6", purpleBg:"rgba(139,92,246,.12)",
  red:"#ef4444",    wa:"#25D366",
};

const fmtD = () => new Date().toLocaleDateString("pt-BR");
const fmtR2= n  => Number(n||0).toFixed(2).replace(".",",");
const fmtBRL=n  => `R$ ${fmtR2(n)}`;
const fmtOS  =n  => n!=null ? `OS-${String(n).padStart(3,"0")}` : "";

// Returns elapsed time string + urgency color since a vehicle entered the shop
function elapsedTime(enteredAt) {
  if (!enteredAt) return null;
  const ms = Date.now() - new Date(enteredAt).getTime();
  if (ms < 0) return null;
  const totalMins = Math.floor(ms / 60000);
  const totalHrs  = Math.floor(totalMins / 60);
  const days      = Math.floor(totalHrs / 24);
  const hrs       = totalHrs % 24;
  const mins      = totalMins % 60;
  let label = "";
  if (days > 0) label = `${days}d ${hrs}h`;
  else if (totalHrs > 0) label = `${totalHrs}h ${mins}m`;
  else label = `${mins}m`;
  // Color: green < 1 day, amber 1-3 days, red > 3 days
  const color = days >= 3 ? "#ef4444" : days >= 1 ? "#f59e0b" : "#16a34a";
  return { label, color, days };
}
const cleanPhone=(p="")=>p.replace(/\D/g,"");
const samePhone=(a,b)=>cleanPhone(a)===cleanPhone(b)&&cleanPhone(a).length>0;
const LOGIN_KEY="osc_mech_session";

// ─── Financial helpers ────────────────────────────────────────────────────────
function vehicleTotal(vehicleId,tasks,defaultRate) {
  return tasks.filter(t=>t.vehicleId===vehicleId).reduce((s,t)=>s+taskCost(t,defaultRate).total,0);
}
function vehiclePaid(vehicleId,payments) {
  return payments.filter(p=>p.vehicleId===vehicleId).reduce((s,p)=>s+Number(p.amount),0);
}
function vehicleBalance(vehicleId,tasks,payments,defaultRate) {
  return vehicleTotal(vehicleId,tasks,defaultRate)-vehiclePaid(vehicleId,payments);
}
// Financial summary across all tasks marked done (only material counts as cost)
function financeSummary(tasks,defaultRate,vehicles,clients,from,to) {
  const inRange = (dateStr)=>{
    if(!dateStr) return true;
    if(from&&dateStr<from) return false;
    if(to&&dateStr>to) return false;
    return true;
  };
  let revenue=0,cost=0,laborRevenue=0,matRevenue=0;
  const doneTasks = tasks.filter(t=>t.done);
  doneTasks.forEach(t=>{
    const c=taskCost(t,defaultRate);
    revenue+=c.total; cost+=c.mat; laborRevenue+=c.labor; matRevenue+=c.mat;
  });
  const profit = revenue-cost;
  return { revenue, cost, profit, laborRevenue, matRevenue, doneCount: doneTasks.length };
}

// ─── Monthly productivity helpers ────────────────────────────────────────────
// Counts Mon–Fri days in a given month (1-indexed month, e.g. 6 = June)
function workingDaysInMonth(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay(); // 0=Sun..6=Sat
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}
const monthKey = (dateStr) => (dateStr ? dateStr.slice(0, 7) : null); // "YYYY-MM"
function monthLabel(key) {
  if (!key) return "";
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}
// Productivity per employee for a given "YYYY-MM" month key
function productivityByEmployee(employees, vehicles, tasks, defaultRate, monthKeyStr) {
  const [y, m] = monthKeyStr.split("-").map(Number);
  const capacityHours = workingDaysInMonth(y, m) * 8;
  return employees.map(emp => {
    const empVehicleIds = vehicles.filter(v => v.employeeId === emp.id).map(v => v.id);
    const monthTasks = tasks.filter(t =>
      t.done && empVehicleIds.includes(t.vehicleId) && monthKey(t.completedAt) === monthKeyStr
    );
    const hoursWorked = monthTasks.reduce((s, t) => s + Number(t.hours || 0), 0);
    const profit = monthTasks.reduce((s, t) => { const c = taskCost(t, defaultRate); return s + (c.total - c.mat); }, 0);
    const ratePerHour = hoursWorked > 0 ? profit / hoursWorked : 0;
    const occupancy = capacityHours > 0 ? Math.min(999, (hoursWorked / capacityHours) * 100) : 0;
    return { employee: emp, hoursWorked, profit, ratePerHour, capacityHours, occupancy, taskCount: monthTasks.length };
  });
}

// ─── Cost helpers ─────────────────────────────────────────────────────────────
const taskCost=(t,defaultRate)=>{
  const rate  = t.ratePerHour!=null ? Number(t.ratePerHour) : Number(defaultRate||0);
  const labor = Number(t.hours||0)*rate;
  const mats  = Array.isArray(t.materials) ? t.materials : [];
  const mat   = mats.reduce((s,m)=>s+Number(m.cost||0)*Number(m.qty||1),0);
  return {labor,mat,total:labor+mat};
};

// ─── Image upload (Supabase Storage) ─────────────────────────────────────────
async function uploadImg(file, folder) {
  return await resizeAndUpload(file, folder);
}

// ─── Public link ─────────────────────────────────────────────────────────────
function getPublicLink(vehicleId) {
  return `${window.location.href.split("?")[0]}?v=${vehicleId}`;
}
function getMechanicPortalLink() {
  return `${window.location.href.split("?")[0]}?portal=mecanico`;
}

// ─── WA builders ─────────────────────────────────────────────────────────────
function waMechanic(emp,vehicles,tasks,clients) {
  const rows=[`🔧 *OSC PERFORMANCE*`,`👤 *Mecânico: ${emp.name}*`,`📅 ${fmtD()}`,`━━━━━━━━━━━━━━━━━━━━`,``];
  vehicles.filter(v=>v.employeeId===emp.id).forEach((v,i)=>{
    const ts=tasks.filter(t=>t.vehicleId===v.id),done=ts.filter(t=>t.done).length;
    const cli=clients.find(c=>c.id===v.clientId);
    rows.push(`🚗 *${i+1}. ${v.model}* — ${v.plate}`);
    if(cli) rows.push(`👤 Cliente: ${cli.name}`);
    rows.push(`📋 ${done}/${ts.length} tarefas`);
    ts.forEach(t=>{
      rows.push(`  ${t.done?"✅":"⬜"} ${t.label}`);
      (t.materials||[]).forEach(m=>rows.push(`     🔩 ${m.name}${m.fromStock?" (estoque)":""}`));
      if(t.hours)    rows.push(`     ⏱ ${t.hours}h`);
    });
    rows.push(``);
  });
  rows.push(`━━━━━━━━━━━━━━━━━━━━`);
  rows.push(`🔗 Acesse sua área: ${getMechanicPortalLink()}`,``);
  rows.push(`_OSC Performance — Excelência em cada revisão_`);
  return rows.join("\n");
}
function waClient(cli,vehicles,tasks,employees,defaultRate) {
  const cliV=vehicles.filter(v=>v.clientId===cli.id);
  let grand=0;
  const rows=[`🔧 *OSC PERFORMANCE*`,``,`Olá, *${cli.name}*! Aqui está o status do seu veículo:`,`📅 ${fmtD()}`,`━━━━━━━━━━━━━━━━━━━━`,``];
  cliV.forEach(v=>{
    const ts=tasks.filter(t=>t.vehicleId===v.id),done=ts.filter(t=>t.done).length;
    const mech=employees.find(e=>e.id===v.employeeId); let vt=0;
    rows.push(`🚗 *${v.model}* — ${v.plate}`);
    if(mech) rows.push(`🔧 Mecânico: ${mech.name}`);
    rows.push(`📋 ${done}/${ts.length} tarefas`,``);
    ts.forEach(t=>{ const c=taskCost(t,defaultRate); vt+=c.total; grand+=c.total;
      rows.push(`  ${t.done?"✅":"⬜"} ${t.label}`);
      (t.materials||[]).forEach(m=>rows.push(`     🔩 ${m.name} — ${fmtBRL(m.cost)}`));
      if(t.hours)    rows.push(`     ⏱ ${t.hours}h mão de obra — ${fmtBRL(c.labor)}`);
    });
    rows.push(``,`  💰 *Subtotal: ${fmtBRL(vt)}*`);
    rows.push(`  🔗 Acompanhe: ${getPublicLink(v.id)}`,``);
  });
  rows.push(`━━━━━━━━━━━━━━━━━━━━`,`💰 *TOTAL: ${fmtBRL(grand)}*`,``,`_OSC Performance — Transparência e qualidade_`);
  return rows.join("\n");
}
function waVehicle(v,tasks,employees,clients,defaultRate) {
  const ts=tasks.filter(t=>t.vehicleId===v.id),done=ts.filter(t=>t.done).length;
  const mech=employees.find(e=>e.id===v.employeeId),cli=clients.find(c=>c.id===v.clientId);
  const total=ts.reduce((s,t)=>s+taskCost(t,defaultRate).total,0);
  const rows=[`🔧 *OSC PERFORMANCE*`,``,`Olá${cli?`, *${cli.name}*`:""}! Atualização do seu veículo:`,``,`🚗 *${v.model}* — ${v.plate}`,`📅 ${fmtD()}`];
  if(mech) rows.push(`🔧 Mecânico: ${mech.name}`);
  rows.push(`📋 Progresso: ${done}/${ts.length} tarefas`,``);
  ts.forEach(t=>{
    rows.push(`  ${t.done?"✅":"⬜"} ${t.label}`);
    (t.materials||[]).forEach(m=>rows.push(`     🔩 ${m.name}`));
  });
  rows.push(``,`🔗 Acompanhe ao vivo: ${getPublicLink(v.id)}`);
  if(total>0) rows.push(``,`💰 *Total previsto: ${fmtBRL(total)}*`);
  if(done===ts.length&&ts.length>0) rows.push(``,`🎉 *Seu veículo está pronto para retirada!*`);
  rows.push(``,`━━━━━━━━━━━━━━━━━━━━`,`_OSC Performance_`);
  return rows.join("\n");
}

// ─── PDF Quote Generator ──────────────────────────────────────────────────────
let _jsPDFPromise = null;
function loadJsPDF() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (_jsPDFPromise) return _jsPDFPromise;
  _jsPDFPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.onload = () => resolve(window.jspdf.jsPDF);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return _jsPDFPromise;
}

async function generateQuotePDF(vehicle, tasks, client, employee, company, defaultRate) {
  const jsPDFCtor = await loadJsPDF();
  const doc = new jsPDFCtor({ unit: "mm", format: "a4" });
  const pageW = 210, marginX = 14, contentW = pageW - marginX * 2;
  let y = 0;

  const orange = [255,107,0], black = [20,20,20], gray = [100,100,100],
        lightGray = [242,242,242], white = [255,255,255];

  // ── Header band ──────────────────────────────────────────────────────────────
  doc.setFillColor(...black);
  doc.rect(0, 0, pageW, 36, "F");
  doc.setFillColor(...orange);
  doc.rect(0, 34, pageW, 2, "F");

  // Company name (left)
  doc.setTextColor(...white);
  doc.setFont("helvetica","bold"); doc.setFontSize(16);
  doc.text(company?.name || "OSC Performance", marginX, 13);

  // Address / contact (left, below name)
  doc.setFont("helvetica","normal"); doc.setFontSize(8);
  doc.setTextColor(200,200,200);
  let hY = 20;
  if (company?.address) { doc.text(company.address, marginX, hY); hY += 5; }
  const contact = [company?.phone&&`Tel: ${company.phone}`, company?.document&&`CNPJ: ${company.document}`].filter(Boolean).join("   ");
  if (contact) doc.text(contact, marginX, hY);

  // Emission date (right side of header)
  doc.setFont("helvetica","italic"); doc.setFontSize(8); doc.setTextColor(180,180,180);
  doc.text(`Emitido em ${fmtD()}`, pageW - marginX, 28, { align: "right" });

  y = 44;

  // ── Title ────────────────────────────────────────────────────────────────────
  doc.setTextColor(...black);
  doc.setFont("helvetica","bold"); doc.setFontSize(13);
  doc.text("ORÇAMENTO DE SERVIÇOS", marginX, y);
  if (vehicle.osNumber) {
    doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...gray);
    doc.text(fmtOS(vehicle.osNumber), pageW - marginX, y, { align: "right" });
  }
  y += 10;

  // ── Info box: client LEFT | vehicle RIGHT | mechanic below vehicle ────────────
  const boxH = 28;
  doc.setFillColor(...lightGray);
  doc.setDrawColor(220,220,220);
  doc.roundedRect(marginX, y, contentW, boxH, 2, 2, "F");

  const halfW = contentW / 2;
  const lx = marginX + 5, rx = marginX + halfW + 5;

  // Labels
  doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...gray);
  doc.text("CLIENTE", lx, y + 6);
  doc.text("VEÍCULO", rx, y + 6);

  // Client name (clipped to left half)
  const clientName = client?.name || "Não informado";
  const clientNameLines = doc.splitTextToSize(clientName, halfW - 10);
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...black);
  doc.text(clientNameLines[0], lx, y + 13);

  // Client phone
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...gray);
  doc.text(client?.phone ? `Tel: ${client.phone}` : "", lx, y + 20);

  // Vehicle model (clipped to right half)
  const vehicleModel = vehicle.model || "";
  const vehicleModelLines = doc.splitTextToSize(vehicleModel, halfW - 10);
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...black);
  doc.text(vehicleModelLines[0], rx, y + 13);

  // Plate + mechanic on same row, right column
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...gray);
  const plateText = `Placa: ${vehicle.plate}`;
  doc.text(plateText, rx, y + 20);
  if (employee?.name) {
    const plateW = doc.getTextWidth(plateText);
    doc.text(`  · Mec: ${employee.name}`, rx + plateW, y + 20);
  }

  y += boxH + 8;

  // ── Table ────────────────────────────────────────────────────────────────────
  // Columns: desc (stretchy) | qty | unit | total
  const cQty   = marginX + contentW - 76;
  const cUnit  = marginX + contentW - 46;
  const cTotal = marginX + contentW;
  const cDescW = cQty - marginX - 8;   // more breathing room for description text

  const drawTableHeader = () => {
    doc.setFillColor(...orange);
    doc.rect(marginX, y, contentW, 8, "F");
    doc.setTextColor(...white); doc.setFont("helvetica","bold"); doc.setFontSize(8.5);
    doc.text("SERVIÇO / MATERIAL", marginX + 3, y + 5.5);
    doc.text("QTD/H",  cQty,   y + 5.5, { align: "right" });
    doc.text("UNIT.",  cUnit,  y + 5.5, { align: "right" });
    doc.text("TOTAL",  cTotal, y + 5.5, { align: "right" });
    y += 8;
  };

  const checkPageBreak = (needed = 10) => {
    if (y + needed > 282) {
      doc.addPage();
      y = 16;
      drawTableHeader();
    }
  };

  drawTableHeader();

  let laborTotal = 0, partsTotal = 0;
  const ts = tasks.filter(t => t.vehicleId === vehicle.id);

  ts.forEach((t, idx) => {
    const c = taskCost(t, defaultRate);
    laborTotal += c.labor;
    partsTotal += c.mat;

    const mats = t.materials || [];
    const rate  = t.ratePerHour != null ? Number(t.ratePerHour) : Number(defaultRate || 0);

    // Calculate label wrap
    doc.setFont("helvetica","bold"); doc.setFontSize(9);
    const labelLines = doc.splitTextToSize(t.label, cDescW);

    // Calculate material lines (each mat may also wrap)
    const matTextLines = mats.map(m => {
      const qty = m.qty || 1;
      const txt = `· ${m.name}${m.fromStock?" (estoque)":""}${qty>1?` ×${qty}`:""}`;
      doc.setFont("helvetica","normal"); doc.setFontSize(8);
      return { lines: doc.splitTextToSize(txt, cDescW - 6), mat: m, qty };
    });

    const labelH  = labelLines.length * 5;
    const matsH   = matTextLines.reduce((s, ml) => s + ml.lines.length * 4.5, 0);
    const rowH    = Math.max(9, labelH + (mats.length > 0 ? matsH + 3 : 0) + 4);

    checkPageBreak(rowH + 2);

    // Row background
    doc.setFillColor(idx % 2 === 0 ? 255 : 249, idx % 2 === 0 ? 255 : 249, idx % 2 === 0 ? 255 : 249);
    doc.setDrawColor(225, 225, 225);
    doc.rect(marginX, y, contentW, rowH, "FD");

    // Service label (multi-line)
    doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...black);
    labelLines.forEach((line, li) => doc.text(line, marginX + 3, y + 5 + li * 5));

    // Right-side values (aligned to first label line)
    doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...gray);
    if (t.hours > 0) doc.text(`${t.hours}h`, cQty,  y + 5, { align: "right" });
    doc.text(t.hours > 0 ? fmtBRL(rate) : "—",   cUnit, y + 5, { align: "right" });
    doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(...black);
    doc.text(fmtBRL(c.labor), cTotal, y + 5, { align: "right" });

    // Material sub-lines
    let matY = y + 5 + labelLines.length * 5;
    matTextLines.forEach(({ lines, mat, qty }) => {
      const matCost = Number(mat.cost || 0);
      const matTotal = matCost * qty;
      doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...gray);
      lines.forEach((line, li) => doc.text(line, marginX + 7, matY + li * 4.5));
      // Only show costs on first line of this material
      doc.text(String(qty), cQty, matY, { align: "right" });
      doc.text(fmtBRL(matCost), cUnit, matY, { align: "right" });
      doc.setTextColor(180, 100, 0);
      doc.text(fmtBRL(matTotal), cTotal, matY, { align: "right" });
      matY += lines.length * 4.5;
    });

    y += rowH + 1;
  });

  y += 5;
  checkPageBreak(42);

  // ── Totals box ───────────────────────────────────────────────────────────────
  const boxW = 85, boxX = pageW - marginX - boxW;
  doc.setDrawColor(220,220,220);
  doc.setFillColor(250,250,250);
  doc.roundedRect(boxX, y, boxW, 34, 2, 2, "FD");

  doc.setFontSize(9); doc.setFont("helvetica","normal"); doc.setTextColor(...gray);
  doc.text("Total de Peças/Materiais",  boxX + 5, y + 9);
  doc.text("Total de Mão de Obra",      boxX + 5, y + 17);
  doc.setFont("helvetica","bold"); doc.setTextColor(...black);
  doc.text(fmtBRL(partsTotal),  boxX + boxW - 5, y + 9,  { align: "right" });
  doc.text(fmtBRL(laborTotal),  boxX + boxW - 5, y + 17, { align: "right" });

  doc.setDrawColor(...orange); doc.setLineWidth(0.4);
  doc.line(boxX + 5, y + 21, boxX + boxW - 5, y + 21);
  doc.setLineWidth(0.2);

  doc.setFillColor(...orange);
  doc.roundedRect(boxX, y + 23, boxW, 11, 2, 2, "F");
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...white);
  doc.text("TOTAL GERAL", boxX + 5, y + 30);
  doc.text(fmtBRL(partsTotal + laborTotal), boxX + boxW - 5, y + 30, { align: "right" });

  y += 42;

  // ── Footer ───────────────────────────────────────────────────────────────────
  if (y + 14 > 282) { doc.addPage(); y = 16; }
  doc.setFont("helvetica","italic"); doc.setFontSize(7.5); doc.setTextColor(...gray);
  const footerLines = doc.splitTextToSize(
    "Este orçamento é uma estimativa e pode sofrer alterações conforme a necessidade do serviço executado.",
    contentW
  );
  footerLines.forEach((l, i) => doc.text(l, marginX, y + i * 4));
  doc.text(`${company?.name || "OSC Performance"} — Excelência em cada revisão`, marginX, y + footerLines.length * 4 + 3);

  const fileName = `orcamento-${vehicle.plate.replace(/\s/g,"")}-${new Date().toISOString().slice(0,10)}.pdf`;
  doc.save(fileName);
}

// ─── AI ──────────────────────────────────────────────────────────────────────
async function aiSuggest(model) {
  const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:600,messages:[{role:"user",content:`Oficina OSC Performance. Sugira 6 tarefas de manutenção para: "${model}". JSON apenas: {"tasks":["...","...","...","...","...","..."]}`}]})});
  const d=await r.json();
  return JSON.parse((d.content||[]).map(c=>c.text||"").join("").replace(/```json|```/g,"").trim()).tasks||[];
}

// ─── Icons ───────────────────────────────────────────────────────────────────
const Svg=({d,s=18,c="currentColor",sw=2,f="none",d2})=>(<svg width={s} height={s} viewBox="0 0 24 24" fill={f} stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"><path d={d}/>{d2&&<path d={d2}/>}</svg>);
const IPlus  =({s=18,c="currentColor"})=><Svg d="M12 5v14M5 12h14" s={s} c={c}/>;
const ITrash =({s=18,c="currentColor"})=><Svg d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" s={s} c={c}/>;
const ICar   =({s=18,c="currentColor"})=><Svg d="M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v5h-3M16 17a2 2 0 100 4 2 2 0 000-4zM7 17a2 2 0 100 4 2 2 0 000-4z" s={s} c={c}/>;
const IUser  =({s=18,c="currentColor"})=><Svg d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" s={s} c={c}/>;
const IChevD =({s=18,c="currentColor"})=><Svg d="M6 9l6 6 6-6" s={s} c={c}/>;
const IChevU =({s=18,c="currentColor"})=><Svg d="M18 15l-6-6-6 6" s={s} c={c}/>;
const ICheck =({s=14,c="#fff"})        =><Svg d="M20 6L9 17l-5-5" s={s} c={c}/>;
const IWrench=({s=18,c="currentColor"})=><Svg d="M14.7 6.3a1 1 0 010 1.4l-8 8a1 1 0 01-.7.3H4v-2l8-8a1 1 0 011.4 0l1.3 1.3zM3 21h18" s={s} c={c}/>;
const IPhone =({s=18,c="currentColor"})=><Svg d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8 19.79 19.79 0 01.1 1.17 2 2 0 012.11 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" s={s} c={c}/>;
const IEdit  =({s=18,c="currentColor"})=><Svg d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" s={s} c={c}/>;
const IArrow =({s=18,c="currentColor"})=><Svg d="M5 12h14M12 5l7 7-7 7" s={s} c={c}/>;
const ICopy  =({s=16,c="currentColor"})=><Svg d="M8 17H5a2 2 0 01-2-2V5a2 2 0 012-2h8a2 2 0 012 2v2M11 21h8a2 2 0 002-2V9a2 2 0 00-2-2h-8a2 2 0 00-2 2v10a2 2 0 002 2z" s={s} c={c}/>;
const IAI    =({s=16,c="currentColor"})=><Svg d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" s={s} c={c}/>;
const ISwap  =({s=16,c="currentColor"})=><Svg d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" s={s} c={c}/>;
const IGear  =({s=16,c="currentColor"})=><Svg d="M12 15a3 3 0 100-6 3 3 0 000 6z" d2="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" s={s} c={c}/>;
const IMoney =({s=16,c="currentColor"})=><Svg d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" s={s} c={c}/>;
const IClock =({s=16,c="currentColor"})=><Svg d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 6v6l4 2" s={s} c={c}/>;
const IBox   =({s=16,c="currentColor"})=><Svg d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" s={s} c={c}/>;
const IPhoto =({s=16,c="currentColor"})=><Svg d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" d2="M12 17a4 4 0 100-8 4 4 0 000 8z" s={s} c={c}/>;
const ILink  =({s=16,c="currentColor"})=><Svg d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" s={s} c={c}/>;
const IWarehouse=({s=18,c="currentColor"})=><Svg d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" d2="M9 22V12h6v10" s={s} c={c}/>;
const ITag   =({s=16,c="currentColor"})=><Svg d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82zM7 7h.01" s={s} c={c}/>;
const IEye   =({s=16,c="currentColor"})=><Svg d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" d2="M12 9a3 3 0 100 6 3 3 0 000-6z" s={s} c={c}/>;
const IX     =({s=14,c="currentColor"})=><Svg d="M18 6L6 18M6 6l12 12" s={s} c={c}/>;
const ILock  =({s=18,c="currentColor"})=><Svg d="M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z" d2="M7 11V7a5 5 0 0110 0v4" s={s} c={c}/>;
const ILogout=({s=18,c="currentColor"})=><Svg d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" d2="M16 17l5-5-5-5M21 12H9" s={s} c={c}/>;
const IHistory=({s=18,c="currentColor"})=><Svg d="M12 8v4l3 3" d2="M3.05 11a9 9 0 1 0 .5-3M3 4v4h4" s={s} c={c}/>;
const IAddressBook=({s=18,c="currentColor"})=><Svg d="M16 2H4a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V4a2 2 0 00-2-2z" d2="M20 8h-4M20 12h-4M20 16h-4M8 9a2 2 0 100-4 2 2 0 000 4zM8 15c-3 0-5 1-5 2v1h10v-1c0-1-2-2-5-2z" s={s} c={c}/>;
const IChart =({s=18,c="currentColor"})=><Svg d="M3 3v18h18" d2="M18 17V9M13 17V5M8 17v-3" s={s} c={c}/>;
const IBank  =({s=18,c="currentColor"})=><Svg d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3" s={s} c={c}/>;
const ISearch=({s=18,c="currentColor"})=><Svg d="M11 19a8 8 0 100-16 8 8 0 000 16z" d2="M21 21l-4.35-4.35" s={s} c={c}/>;
const IFileText=({s=18,c="currentColor"})=><Svg d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" d2="M14 2v6h6M16 13H8M16 17H8M10 9H8" s={s} c={c}/>;
const ITrendUp=({s=16,c="currentColor"})=><Svg d="M23 6l-9.5 9.5-5-5L1 18" d2="M17 6h6v6" s={s} c={c}/>;

// ─── Shared UI ────────────────────────────────────────────────────────────────
function ProgressBar({value,max}) {
  const p=max===0?0:Math.round(value/max*100);
  return (<div style={{display:"flex",alignItems:"center",gap:8,marginTop:4}}>
    <div style={{flex:1,height:5,borderRadius:99,background:B.gray700,overflow:"hidden"}}>
      <div style={{width:`${p}%`,height:"100%",background:p===100?B.green:B.orange,borderRadius:99,transition:"width .4s"}}/>
    </div>
    <span style={{fontSize:11,color:p===100?B.green:B.gray400,minWidth:30,textAlign:"right",fontWeight:700}}>{p}%</span>
  </div>);
}
function Toast({msg,onDone}) {
  useEffect(()=>{const t=setTimeout(onDone,2500);return()=>clearTimeout(t);},[onDone]);
  return <div style={{position:"fixed",bottom:28,left:"50%",transform:"translateX(-50%)",background:B.orange,color:B.white,padding:"10px 24px",borderRadius:99,fontWeight:700,fontSize:14,zIndex:999,boxShadow:"0 4px 24px rgba(255,107,0,.4)",pointerEvents:"none",whiteSpace:"nowrap"}}>{msg}</div>;
}
function InlineEdit({value,onSave,placeholder,type="text"}) {
  const [e,sE]=useState(false); const [v,sV]=useState(value||"");
  if(!e) return (<button onClick={()=>{sV(value||"");sE(true);}} style={{background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center",gap:4}}>
    <span style={{color:value?B.white:B.gray400,fontSize:13}}>{value||placeholder}</span><IEdit s={10} c={B.gray500}/></button>);
  return (<div style={{display:"flex",gap:5,alignItems:"center"}}>
    <input autoFocus value={v} onChange={ev=>sV(ev.target.value)} type={type}
      onKeyDown={ev=>{if(ev.key==="Enter"){onSave(v);sE(false);}if(ev.key==="Escape")sE(false);}}
      style={{padding:"3px 8px",borderRadius:6,border:`1px solid ${B.gray600}`,background:B.gray700,color:B.white,fontSize:12,outline:"none",width:type==="number"?80:170}}/>
    <button onClick={()=>{onSave(v);sE(false);}} style={{padding:"3px 8px",borderRadius:5,background:B.green,border:"none",color:B.white,cursor:"pointer",fontWeight:700,fontSize:11}}>OK</button>
    <button onClick={()=>sE(false)} style={{padding:"3px 6px",borderRadius:5,background:B.gray700,border:"none",color:B.gray200,cursor:"pointer",fontSize:11}}>✕</button>
  </div>);
}
function UploadBtn({onFile,label="Adicionar foto",accept="image/*",style={},folder="misc"}) {
  const ref=useRef();
  const [busy,setBusy]=useState(false);
  return (<>
    <button onClick={()=>ref.current.click()} disabled={busy} style={{padding:"6px 12px",borderRadius:7,background:B.purpleBg,border:`1px dashed ${B.purple}66`,color:B.purple,cursor:busy?"wait":"pointer",fontWeight:600,fontSize:12,display:"flex",alignItems:"center",gap:5,opacity:busy?.6:1,...style}}>
      <IPhoto s={13} c={B.purple}/>{busy?"Enviando…":label}
    </button>
    <input ref={ref} type="file" accept={accept} style={{display:"none"}} onChange={async e=>{
      const f=e.target.files[0];
      if(f){
        setBusy(true);
        try{ const url=await uploadImg(f,folder); onFile(url); }
        catch(err){ alert("Erro ao enviar foto: "+err.message); }
        setBusy(false);
      }
      e.target.value="";
    }}/>
  </>);
}

// ─── PhotoGallery ─────────────────────────────────────────────────────────────
function PhotoGallery({photos=[],onAdd,onRemove,readOnly=false,maxH=140}) {
  const [lightbox,setLB]=useState(null);
  return (<>
    <div style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:8}}>
      {photos.map((src,i)=>(
        <div key={i} style={{position:"relative",width:maxH,height:maxH,borderRadius:8,overflow:"hidden",border:`1px solid ${B.gray600}`,flexShrink:0,cursor:"pointer"}} onClick={()=>setLB(src)}>
          <img src={src} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
          {!readOnly&&<button onClick={e=>{e.stopPropagation();onRemove(i);}} style={{position:"absolute",top:4,right:4,background:"rgba(0,0,0,.7)",border:"none",borderRadius:99,width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
            <IX s={12} c={B.white}/>
          </button>}
        </div>
      ))}
      {!readOnly&&<UploadBtn onFile={onAdd} folder="os-photos" label="+ Foto" style={{width:maxH,height:maxH,justifyContent:"center",flexDirection:"column",gap:6,borderRadius:8,fontSize:11}}/>}
    </div>
    {lightbox&&(
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.95)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setLB(null)}>
        <img src={lightbox} alt="" style={{maxWidth:"95vw",maxHeight:"95vh",objectFit:"contain",borderRadius:8}}/>
        <button onClick={()=>setLB(null)} style={{position:"fixed",top:16,right:16,background:"rgba(255,255,255,.1)",border:"none",borderRadius:99,padding:10,cursor:"pointer"}}><IX s={18} c={B.white}/></button>
      </div>
    )}
  </>);
}

// ─── ShareModal ───────────────────────────────────────────────────────────────
function ShareModal({title,subtitle,phone,text,accentColor=B.wa,onClose}) {
  const [cp,sC]=useState(false);
  const num=cleanPhone(phone||"");
  const copy=()=>navigator.clipboard?.writeText(text).then(()=>{sC(true);setTimeout(()=>sC(false),2000);});
  return (<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:80,padding:16}} onClick={onClose}>
    <div style={{background:B.gray800,borderRadius:16,maxWidth:500,width:"100%",overflow:"hidden",border:`1px solid ${B.gray700}`,boxShadow:"0 24px 80px rgba(0,0,0,.7)"}} onClick={e=>e.stopPropagation()}>
      <div style={{padding:"16px 20px",background:B.gray900,borderBottom:`2px solid ${accentColor}`,display:"flex",alignItems:"center",gap:12}}>
        <div style={{width:40,height:40,borderRadius:9,background:accentColor,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><IPhone s={18} c={B.white}/></div>
        <div><div style={{fontWeight:700,fontSize:15,color:B.white}}>{title}</div><div style={{fontSize:12,color:B.gray400}}>{subtitle}</div></div>
      </div>
      <div style={{padding:20}}>
        <textarea readOnly value={text} style={{width:"100%",height:200,padding:12,borderRadius:8,border:`1px solid ${B.gray700}`,background:B.gray900,color:B.gray200,fontSize:12.5,fontFamily:"monospace",resize:"none",boxSizing:"border-box",lineHeight:1.6}}/>
        <div style={{display:"flex",gap:8,marginTop:14,flexWrap:"wrap"}}>
          {phone&&<button onClick={()=>window.open(`https://wa.me/${num}?text=${encodeURIComponent(text)}`,"_blank")} style={{flex:2,minWidth:150,padding:"10px 0",borderRadius:10,background:B.wa,border:"none",color:B.white,fontWeight:800,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",gap:7}}>📲 Enviar direto</button>}
          <button onClick={()=>window.open(`https://wa.me/?text=${encodeURIComponent(text)}`,"_blank")} style={{flex:1,minWidth:100,padding:"10px 0",borderRadius:10,background:phone?B.gray700:B.wa,border:`1px solid ${B.gray600}`,color:B.white,fontWeight:700,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>📱 WA</button>
          <button onClick={copy} style={{padding:"10px 12px",borderRadius:10,background:cp?B.greenBg:B.gray700,border:`1px solid ${cp?B.green:B.gray600}`,color:cp?B.green:B.gray200,cursor:"pointer",fontWeight:600,fontSize:12,display:"flex",alignItems:"center",gap:4}}><ICopy s={13}/>{cp?"Copiado!":"Copiar"}</button>
          <button onClick={onClose} style={{padding:"10px 12px",borderRadius:10,background:B.gray700,border:`1px solid ${B.gray600}`,color:B.gray200,cursor:"pointer",fontWeight:600,fontSize:12}}>✕</button>
        </div>
      </div>
    </div>
  </div>);
}

// ─── TransferModal ────────────────────────────────────────────────────────────
// ─── Confirm Modal (generic confirmation dialog) ──────────────────────────────
function ConfirmModal({title,message,confirmLabel="Confirmar",danger=true,onConfirm,onCancel}) {
  return (<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:16}} onClick={onCancel}>
    <div style={{background:B.gray800,borderRadius:16,maxWidth:380,width:"100%",overflow:"hidden",border:`1px solid ${danger?B.red+"55":B.gray600}`,boxShadow:"0 24px 80px rgba(0,0,0,.7)"}} onClick={e=>e.stopPropagation()}>
      <div style={{padding:"16px 20px",background:B.gray900,borderBottom:`2px solid ${danger?B.red:B.gray600}`,display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:36,height:36,borderRadius:8,background:danger?`${B.red}22`:B.gray700,display:"flex",alignItems:"center",justifyContent:"center"}}>
          {danger?<ITrash s={17} c={B.red}/>:<IEdit s={17} c={B.gray200}/>}
        </div>
        <div style={{fontWeight:700,fontSize:15,color:B.white}}>{title}</div>
      </div>
      <div style={{padding:20}}>
        <div style={{fontSize:13.5,color:B.gray200,lineHeight:1.5,marginBottom:18}}>{message}</div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={onConfirm} style={{flex:1,padding:"10px 0",borderRadius:9,background:danger?B.red:B.purple,border:"none",color:B.white,fontWeight:800,cursor:"pointer",fontSize:13}}>{confirmLabel}</button>
          <button onClick={onCancel} style={{padding:"10px 16px",borderRadius:9,background:B.gray700,border:`1px solid ${B.gray600}`,color:B.gray200,cursor:"pointer",fontWeight:600,fontSize:13}}>Cancelar</button>
        </div>
      </div>
    </div>
  </div>);
}

// ─── Field label (small caption above an input) ───────────────────────────────
function FieldLabel({children}) {
  return <div style={{fontSize:10.5,color:B.gray400,fontWeight:600,marginBottom:3,textTransform:"uppercase",letterSpacing:.3}}>{children}</div>;
}
function Field({label,children,flex}) {
  return <div style={{flex:flex||1,display:"flex",flexDirection:"column"}}><FieldLabel>{label}</FieldLabel>{children}</div>;
}

function TransferModal({title,subtitle,items,onPick,onClose}) {
  return (<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:90,padding:16}} onClick={onClose}>
    <div style={{background:B.gray800,borderRadius:16,maxWidth:420,width:"100%",overflow:"hidden",border:`1px solid ${B.gray600}`}} onClick={e=>e.stopPropagation()}>
      <div style={{padding:"14px 18px",background:B.gray900,borderBottom:`2px solid ${B.orange}`,display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:34,height:34,borderRadius:8,background:`${B.orange}22`,display:"flex",alignItems:"center",justifyContent:"center"}}><ISwap s={16} c={B.orange}/></div>
        <div><div style={{fontWeight:700,fontSize:14,color:B.white}}>{title}</div><div style={{fontSize:12,color:B.gray400}}>{subtitle}</div></div>
      </div>
      <div style={{padding:16,maxHeight:340,overflowY:"auto"}}>
        {items.length===0?<div style={{textAlign:"center",padding:"16px 0",color:B.gray400,fontSize:13}}>Nenhuma opção.</div>
          :items.map(it=>(<button key={it.id} onClick={()=>onPick(it.id)} style={{width:"100%",textAlign:"left",padding:"10px 12px",borderRadius:9,background:B.gray700,border:`1px solid ${B.gray600}`,color:B.white,cursor:"pointer",marginBottom:7,display:"flex",alignItems:"center",gap:9,transition:"all .15s"}}
            onMouseEnter={e=>{e.currentTarget.style.background=`${B.orange}22`;e.currentTarget.style.borderColor=B.orange;}}
            onMouseLeave={e=>{e.currentTarget.style.background=B.gray700;e.currentTarget.style.borderColor=B.gray600;}}>
            <div style={{width:32,height:32,borderRadius:7,background:`${B.orange}22`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{it.icon}</div>
            <div><div style={{fontWeight:700,fontSize:13}}>{it.label}</div>{it.sub&&<div style={{fontSize:11,color:B.gray400}}>{it.sub}</div>}</div>
          </button>))}
        <button onClick={onClose} style={{width:"100%",marginTop:4,padding:"9px 0",borderRadius:9,background:B.gray700,border:`1px solid ${B.gray600}`,color:B.gray200,cursor:"pointer",fontWeight:600,fontSize:13}}>Cancelar</button>
      </div>
    </div>
  </div>);
}

// ─── Stock picker modal ───────────────────────────────────────────────────────
function StockPickerModal({stock,onPick,onClose}) {
  const [q,setQ]=useState("");
  const filtered=stock.filter(s=>s.name.toLowerCase().includes(q.toLowerCase())||s.brand.toLowerCase().includes(q.toLowerCase()));
  return (<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:95,padding:16}} onClick={onClose}>
    <div style={{background:B.gray800,borderRadius:16,maxWidth:460,width:"100%",overflow:"hidden",border:`1px solid ${B.gray600}`}} onClick={e=>e.stopPropagation()}>
      <div style={{padding:"14px 18px",background:B.gray900,borderBottom:`2px solid ${B.purple}`,display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:34,height:34,borderRadius:8,background:B.purpleBg,display:"flex",alignItems:"center",justifyContent:"center"}}><IWarehouse s={16} c={B.purple}/></div>
        <div><div style={{fontWeight:700,fontSize:14,color:B.white}}>Selecionar do Estoque</div><div style={{fontSize:12,color:B.gray400}}>Clique para usar o item</div></div>
      </div>
      <div style={{padding:16}}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar produto…" autoFocus
          style={{width:"100%",padding:"8px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none",boxSizing:"border-box",marginBottom:12}}/>
        <div style={{maxHeight:300,overflowY:"auto"}}>
          {filtered.length===0?<div style={{textAlign:"center",padding:"16px 0",color:B.gray400,fontSize:13}}>Nenhum produto encontrado.</div>
            :filtered.map(s=>(
              <button key={s.id} onClick={()=>onPick(s)} disabled={s.qty<=0} style={{width:"100%",textAlign:"left",padding:"10px 12px",borderRadius:9,background:s.qty>0?B.gray700:B.gray800,border:`1px solid ${s.qty>0?B.gray600:B.gray700}`,color:s.qty>0?B.white:B.gray500,cursor:s.qty>0?"pointer":"not-allowed",marginBottom:7,display:"flex",alignItems:"center",gap:10,opacity:s.qty>0?1:.6}}
                onMouseEnter={e=>{if(s.qty>0){e.currentTarget.style.background=B.purpleBg;e.currentTarget.style.borderColor=B.purple;}}}
                onMouseLeave={e=>{if(s.qty>0){e.currentTarget.style.background=B.gray700;e.currentTarget.style.borderColor=B.gray600;}}}>
                {s.photo?<img src={s.photo} alt="" style={{width:36,height:36,borderRadius:7,objectFit:"cover",flexShrink:0}}/>
                  :<div style={{width:36,height:36,borderRadius:7,background:B.purpleBg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><IBox s={16} c={B.purple}/></div>}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</div>
                  <div style={{fontSize:11,color:B.gray400}}>{s.brand} · {s.type} · Qtd: {s.qty}</div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontSize:12,fontWeight:800,color:B.amber}}>{fmtBRL(s.salePrice)}</div>
                  <div style={{fontSize:10,color:B.gray400}}>venda</div>
                </div>
              </button>
            ))}
        </div>
        <button onClick={onClose} style={{width:"100%",marginTop:8,padding:"9px 0",borderRadius:9,background:B.gray700,border:`1px solid ${B.gray600}`,color:B.gray200,cursor:"pointer",fontWeight:600,fontSize:13}}>Cancelar</button>
      </div>
    </div>
  </div>);
}

// ─── TaskItem — Mechanic ──────────────────────────────────────────────────────
// ─── Material chip (one material entry in a task) ─────────────────────────────
function MaterialChip({mat,idx,onUpdate,onRemove,showCost=false,readOnlyName=false,editableQty=false}) {
  const qty = mat.qty || 1;
  const lineTotal = Number(mat.cost||0)*qty;
  return (<div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",background:mat.fromStock?B.purpleBg:B.gray700,border:mat.fromStock?`1px solid ${B.purple}44`:"none",borderRadius:6,padding:"5px 9px",width:"100%",boxSizing:"border-box"}}>
    {mat.fromStock?<IWarehouse s={12} c={B.purple}/>:<IBox s={12} c={B.gray400}/>}
    {readOnlyName||mat.fromStock
      ?<span style={{fontSize:12,color:mat.fromStock?B.purple:B.gray200,fontWeight:mat.fromStock?600:400,flex:1,minWidth:0}}>{mat.name}</span>
      :<span style={{flex:1,minWidth:0}}><InlineEdit value={mat.name} onSave={v=>onUpdate(idx,{...mat,name:v})} placeholder="Nome do material"/></span>}
    {/* Quantity */}
    {editableQty
      ?<span style={{display:"flex",alignItems:"center",gap:3,marginLeft:4,paddingLeft:6,borderLeft:`1px solid ${mat.fromStock?B.purple+"44":B.gray600}`}}>
          <span style={{fontSize:10,color:B.gray400}}>×</span>
          <InlineEdit value={String(qty)} onSave={v=>onUpdate(idx,{...mat,qty:Math.max(1,parseInt(v)||1)})} placeholder="1" type="number"/>
        </span>
      :<span style={{fontSize:11,color:B.gray400,marginLeft:4}}>×{qty}</span>}
    {showCost&&!mat.fromStock&&(
      <span style={{display:"flex",alignItems:"center",gap:3,marginLeft:4,paddingLeft:6,borderLeft:`1px solid ${B.gray600}`}}>
        <span style={{fontSize:10,color:B.amber}}>R$</span>
        <InlineEdit value={mat.cost?fmtR2(mat.cost):""} onSave={v=>onUpdate(idx,{...mat,cost:parseFloat(v.replace(",","."))||0})} placeholder="0" type="number"/>
      </span>
    )}
    {showCost&&mat.fromStock&&<span style={{fontSize:11,color:B.purple,marginLeft:4,paddingLeft:6,borderLeft:`1px solid ${B.purple}44`}}>{fmtBRL(mat.cost)}/un</span>}
    {showCost&&qty>1&&<span style={{fontSize:11,color:B.amber,fontWeight:700,marginLeft:4,paddingLeft:6,borderLeft:`1px solid ${B.amber}44`}}>{fmtBRL(lineTotal)}</span>}
    <button onClick={()=>onRemove(idx)} style={{background:"none",border:"none",cursor:"pointer",color:B.gray500,padding:1,display:"flex",marginLeft:2}}
      onMouseEnter={e=>e.currentTarget.style.color=B.red} onMouseLeave={e=>e.currentTarget.style.color=B.gray500}><IX s={11}/></button>
  </div>);
}

// ─── Task label (service name) — editable inline ──────────────────────────────
function TaskLabel({task,onUpdate}) {
  const [editing,setEditing]=useState(false);
  const [v,setV]=useState(task.label);
  if(editing) return (
    <div style={{flex:1,display:"flex",gap:6,alignItems:"center"}}>
      <input autoFocus value={v} onChange={e=>setV(e.target.value)}
        onKeyDown={e=>{
          if(e.key==="Enter"){ if(v.trim()){onUpdate(task.id,{label:v.trim()});} setEditing(false); }
          if(e.key==="Escape"){ setV(task.label); setEditing(false); }
        }}
        style={{flex:1,padding:"4px 8px",borderRadius:6,border:`1px solid ${B.orange}66`,background:B.gray900,color:B.white,fontSize:13.5,outline:"none"}}/>
      <button onClick={()=>{ if(v.trim()){onUpdate(task.id,{label:v.trim()});} setEditing(false); }} style={{padding:"4px 9px",borderRadius:5,background:B.green,border:"none",color:B.white,cursor:"pointer",fontWeight:700,fontSize:11,flexShrink:0}}>OK</button>
      <button onClick={()=>{setV(task.label);setEditing(false);}} style={{padding:"4px 7px",borderRadius:5,background:B.gray700,border:"none",color:B.gray200,cursor:"pointer",fontSize:11,flexShrink:0}}>✕</button>
    </div>
  );
  return (
    <div style={{flex:1,display:"flex",alignItems:"center",gap:6,paddingTop:1}}>
      <span style={{fontSize:13.5,color:task.done?B.gray400:B.gray200,textDecoration:task.done?"line-through":"none"}}>{task.label}</span>
      <button onClick={()=>{setV(task.label);setEditing(true);}} title="Editar nome do serviço" style={{background:"none",border:"none",cursor:"pointer",color:B.gray500,padding:1,display:"flex",flexShrink:0}}
        onMouseEnter={e=>e.currentTarget.style.color=B.orange} onMouseLeave={e=>e.currentTarget.style.color=B.gray500}><IEdit s={11}/></button>
    </div>
  );
}

// ─── TaskItem — Mechanic ──────────────────────────────────────────────────────
function TaskItemMechanic({task,onToggle,onDelete,onUpdate,employees=[]}) {
  const mats = task.materials||[];
  const [newMat,setNewMat]=useState("");
  const [confirmDel,setConfirmDel]=useState(false);
  const signer = task.completedByEmployeeId ? employees.find(e=>e.id===task.completedByEmployeeId) : null;
  const addMat=()=>{ if(!newMat.trim())return; onUpdate(task.id,{materials:[...mats,{name:newMat.trim(),cost:0,qty:1,fromStock:false,stockItemId:null}]}); setNewMat(""); };
  const updMat=(idx,patch)=>onUpdate(task.id,{materials:mats.map((m,i)=>i===idx?patch:m)});
  const rmMat =(idx)=>onUpdate(task.id,{materials:mats.filter((_,i)=>i!==idx)});

  return (<><div style={{padding:"8px 0",borderBottom:`1px solid ${B.gray700}`}}>
    <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
      <button onClick={()=>onToggle(task.id)} style={{width:22,height:22,borderRadius:5,flexShrink:0,marginTop:1,cursor:"pointer",border:task.done?"none":`2px solid ${B.gray600}`,background:task.done?B.green:"transparent",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s"}}>
        {task.done&&<ICheck/>}
      </button>
      <div style={{flex:1,minWidth:0}}>
        <TaskLabel task={task} onUpdate={onUpdate}/>
        {signer&&task.done&&<div style={{marginTop:2}}>
          <span style={{fontSize:10,color:B.green,background:B.greenBg,border:`1px solid ${B.green}33`,borderRadius:5,padding:"1px 6px",whiteSpace:"nowrap"}}>✓ {signer.name}</span>
        </div>}
      </div>
      <button onClick={()=>setConfirmDel(true)} style={{background:"none",border:"none",cursor:"pointer",color:B.gray600,padding:2,display:"flex",flexShrink:0,marginTop:1}}
        onMouseEnter={e=>e.currentTarget.style.color=B.red} onMouseLeave={e=>e.currentTarget.style.color=B.gray600}><ITrash s={14}/></button>
    </div>
    <div style={{marginLeft:30,marginTop:6}}>
      {/* materials list */}
      <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:mats.length?6:0}}>
        {mats.map((m,idx)=><MaterialChip key={idx} mat={m} idx={idx} onUpdate={updMat} onRemove={rmMat} readOnlyName editableQty/>)}
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {/* add material */}
        <div style={{display:"flex",alignItems:"center",gap:5,background:B.gray700,borderRadius:6,padding:"4px 9px",flex:"1 1 160px"}}>
          <IBox s={12} c={B.gray400}/>
          <input value={newMat} onChange={e=>setNewMat(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addMat()} placeholder="+ Adicionar material"
            style={{background:"none",border:"none",outline:"none",color:B.white,fontSize:12,flex:1,minWidth:60}}/>
          {newMat.trim()&&<button onClick={addMat} style={{background:"none",border:"none",cursor:"pointer",color:B.green,display:"flex"}}><IPlus s={13} c={B.green}/></button>}
        </div>
        {/* hours */}
        <div style={{display:"flex",alignItems:"center",gap:5,background:B.gray700,borderRadius:6,padding:"4px 9px",flexShrink:0}}>
          <IClock s={12} c={B.gray400}/>
          <InlineEdit value={task.hours?String(task.hours):""} onSave={v=>onUpdate(task.id,{hours:parseFloat(v)||0})} placeholder="Horas" type="number"/>
          <span style={{fontSize:11,color:B.gray400}}>h</span>
        </div>
      </div>
    </div>
  </div>
  {confirmDel&&<ConfirmModal title="Excluir tarefa?" message={<>Excluir <b style={{color:B.white}}>{task.label}</b>? Esta ação não pode ser desfeita.</>} confirmLabel="Excluir tarefa" onConfirm={()=>{onDelete(task.id);setConfirmDel(false);}} onCancel={()=>setConfirmDel(false)}/>}
  </>);
}

// ─── TaskItem — Manager ───────────────────────────────────────────────────────
function TaskItemManager({task,defaultRate,stock,onToggle,onDelete,onUpdate,onConsumeStock,onReturnStock,employees=[]}) {
  const [showSP,setSP]=useState(false);
  const [confirmDel,setConfirmDel]=useState(false);
  const [newMat,setNewMat]=useState("");
  const c=taskCost(task,defaultRate);
  const mats = task.materials||[];
  const signer = task.completedByEmployeeId ? employees.find(e=>e.id===task.completedByEmployeeId) : null;

  const addMat=()=>{ if(!newMat.trim())return; onUpdate(task.id,{materials:[...mats,{name:newMat.trim(),cost:0,qty:1,fromStock:false,stockItemId:null}]}); setNewMat(""); };
  const updMat=(idx,patch)=>onUpdate(task.id,{materials:mats.map((m,i)=>i===idx?patch:m)});
  const rmMat =(idx)=>{
    const m=mats[idx];
    if(m?.fromStock&&m?.stockItemId&&onReturnStock) onReturnStock(task.id,idx,m.stockItemId);
    else onUpdate(task.id,{materials:mats.filter((_,i)=>i!==idx)});
  };
  const pickStock=(item)=>{
    onConsumeStock(task.id,item,mats);
    setSP(false);
  };

  return (<>
    <div style={{padding:"8px 0",borderBottom:`1px solid ${B.gray700}`}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
        <button onClick={()=>onToggle(task.id)} style={{width:22,height:22,borderRadius:5,flexShrink:0,marginTop:1,cursor:"pointer",border:task.done?"none":`2px solid ${B.gray600}`,background:task.done?B.green:"transparent",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s"}}>
          {task.done&&<ICheck/>}
        </button>
        <div style={{flex:1,minWidth:0}}>
          <TaskLabel task={task} onUpdate={onUpdate}/>
          {signer&&task.done&&<div style={{marginTop:2}}>
            <span style={{fontSize:10,color:B.green,background:B.greenBg,border:`1px solid ${B.green}33`,borderRadius:5,padding:"1px 6px",whiteSpace:"nowrap"}}>✓ {signer.name}</span>
          </div>}
        </div>
        {c.total>0&&<span style={{fontSize:12,fontWeight:800,color:B.amber,flexShrink:0}}>{fmtBRL(c.total)}</span>}
        <button onClick={()=>setConfirmDel(true)} style={{background:"none",border:"none",cursor:"pointer",color:B.gray600,padding:2,display:"flex",flexShrink:0,marginTop:1}}
          onMouseEnter={e=>e.currentTarget.style.color=B.red} onMouseLeave={e=>e.currentTarget.style.color=B.gray600}><ITrash s={14}/></button>
      </div>
      <div style={{marginLeft:30,marginTop:7}}>
        {/* materials list */}
        <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:mats.length?6:0}}>
          {mats.map((m,idx)=><MaterialChip key={idx} mat={m} idx={idx} onUpdate={updMat} onRemove={rmMat} showCost editableQty/>)}
        </div>
        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
          {/* add material row */}
          <div style={{display:"flex",alignItems:"center",gap:5,flex:"1 1 160px",flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:5,background:B.gray700,borderRadius:6,padding:"4px 9px",flex:1}}>
              <IBox s={12} c={B.gray400}/>
              <input value={newMat} onChange={e=>setNewMat(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addMat()} placeholder="+ Adicionar material"
                style={{background:"none",border:"none",outline:"none",color:B.white,fontSize:12,flex:1,minWidth:60}}/>
              {newMat.trim()&&<button onClick={addMat} style={{background:"none",border:"none",cursor:"pointer",color:B.green,display:"flex"}}><IPlus s={13} c={B.green}/></button>}
            </div>
            <button onClick={()=>setSP(true)} style={{padding:"4px 8px",borderRadius:6,background:B.purpleBg,border:`1px solid ${B.purple}44`,color:B.purple,cursor:"pointer",fontWeight:600,fontSize:11,display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap"}}>
              <IWarehouse s={11} c={B.purple}/>Do estoque
            </button>
          </div>
          {/* Hours */}
          <div style={{display:"flex",alignItems:"center",gap:5,background:B.gray700,borderRadius:6,padding:"4px 9px",minWidth:90}}>
            <IClock s={12} c={B.gray400}/>
            <InlineEdit value={task.hours?String(task.hours):""} onSave={v=>onUpdate(task.id,{hours:parseFloat(v)||0})} placeholder="Horas" type="number"/>
            <span style={{fontSize:11,color:B.gray400}}>h</span>
          </div>
          {/* Rate */}
          <div style={{display:"flex",alignItems:"center",gap:5,background:B.amberBg,border:`1px solid ${B.amber}44`,borderRadius:6,padding:"4px 9px",minWidth:100}}>
            <span style={{fontSize:10,color:B.amber,fontWeight:700}}>R$/h</span>
            <InlineEdit value={task.ratePerHour!=null?fmtR2(task.ratePerHour):""} onSave={v=>onUpdate(task.id,{ratePerHour:v===""||v==="0"?null:parseFloat(v.replace(",","."))||0})} placeholder={`${fmtR2(defaultRate)} (pad)`} type="number"/>
          </div>
        </div>
      </div>
      {(c.labor>0||c.mat>0)&&<div style={{marginTop:5,marginLeft:30,display:"flex",gap:10,flexWrap:"wrap"}}>
        {c.labor>0&&<span style={{fontSize:11,color:B.gray400}}>⏱ <b style={{color:B.amber}}>{fmtBRL(c.labor)}</b></span>}
        {c.mat>0&&<span style={{fontSize:11,color:B.gray400}}>🔩 <b style={{color:B.amber}}>{fmtBRL(c.mat)}</b></span>}
      </div>}
    </div>
    {showSP&&<StockPickerModal stock={stock} onPick={pickStock} onClose={()=>setSP(false)}/>}
    {confirmDel&&<ConfirmModal title="Excluir tarefa?" message={<>Excluir <b style={{color:B.white}}>{task.label}</b>? Esta ação não pode ser desfeita.</>} confirmLabel="Excluir tarefa" onConfirm={()=>{onDelete(task.id);setConfirmDel(false);}} onCancel={()=>setConfirmDel(false)}/>}
  </>);
}

// ─── VehicleCard ──────────────────────────────────────────────────────────────
function VehicleCard({vehicle,tasks,employees,clients,stock,defaultRate,managerMode,onAddTask,onToggleTask,onDeleteTask,onUpdateTask,onDeleteVehicle,onTransferMechanic,onTransferOwner,onUpdateVehicle,onConsumeStock,onReturnStock,hideManagerButtons=false,payments=[],onAddPayment,onDeletePayment,company,onAddMechanic,onRemoveMechanic,onSetStatus,isOwner=false}) {
  const [open,setOpen] = useState(false);
  const [newT,setNewT] = useState("");
  const [aiL, setAiL] = useState(false);
  const [aiS, setAiS] = useState([]);
  const [xfM, setXfM] = useState(false);
  const [xfO, setXfO] = useState(false);
  const [showPhotos,setSP]=useState(false);
  const [cpLink,setCPL]=useState(false);
  const [showAccount,setSA]=useState(false);
  const [confirmDelV,setConfirmDelV]=useState(false);
  const [pdfLoading,setPdfLoading]=useState(false);

  const vts   = tasks.filter(t=>t.vehicleId===vehicle.id);
  const done  = vts.filter(t=>t.done).length;
  const mechs = (vehicle.mechanicIds||[]).map(id=>employees.find(e=>e.id===id)).filter(Boolean);
  const mech  = mechs[0] || null;  // first mechanic for PDF compat
  const cli   = clients.find(c=>c.id===vehicle.clientId);
  const total = managerMode?vts.reduce((s,t)=>s+taskCost(t,defaultRate).total,0):0;
  const photos= vehicle.photos||[];
  const pubLink=getPublicLink(vehicle.id);
  const statusColors = {active:{bg:`${B.green}22`,border:`${B.green}44`,color:B.green,label:"Ativo"}, paused:{bg:`${B.amber}22`,border:`${B.amber}44`,color:B.amber,label:"⏸ Aguardando cliente"}, ready:{bg:`${B.blue}22`,border:`${B.blue}44`,color:B.blue,label:"✓ Pronto"}};
  const sc = statusColors[vehicle.status||"active"];

  const addT=()=>{if(!newT.trim())return;onAddTask(vehicle.id,newT.trim());setNewT("");};
  const doAI=async()=>{setAiL(true);setAiS([]);try{setAiS(await aiSuggest(vehicle.model));}catch{}setAiL(false);};
  const copyLink=()=>{navigator.clipboard?.writeText(pubLink);setCPL(true);setTimeout(()=>setCPL(false),2000);};
  const doPDF=async()=>{
    setPdfLoading(true);
    try{ await generateQuotePDF(vehicle,tasks,cli,mech,company,defaultRate); }
    catch(err){ alert("Erro ao gerar PDF: "+err.message); }
    setPdfLoading(false);
  };

  return (<>
    <div style={{background:B.gray800,borderRadius:10,border:`1px solid ${B.gray700}`,overflow:"hidden",marginBottom:10}}>
      {/* header */}
      <div style={{display:"flex",alignItems:"center",gap:10,background:B.gray700,padding:"10px 14px",cursor:"pointer"}} onClick={()=>setOpen(o=>!o)}>
        {/* Car photo thumb */}
        {vehicle.photo
          ?<img src={vehicle.photo} alt="" style={{width:44,height:44,borderRadius:8,objectFit:"cover",flexShrink:0,border:`1px solid ${B.gray600}`}}/>
          :<div style={{width:44,height:44,borderRadius:8,background:`${B.orange}22`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><ICar s={20} c={B.orange}/></div>}
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:700,fontSize:13.5,color:B.white,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{vehicle.model}</div>
          <div style={{fontSize:11,color:B.gray400,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontFamily:"monospace"}}>{vehicle.plate}</span>
            {vehicle.osNumber&&<span style={{background:`${B.orange}22`,color:B.orange,borderRadius:5,padding:"0px 6px",fontWeight:700,fontSize:10}}>{fmtOS(vehicle.osNumber)}</span>}
            {cli&&<span style={{color:B.blue}}>👤 {cli.name}</span>}
            {mechs.length>0&&<span style={{color:B.orange}}>🔧 {mechs.map(m=>m.name).join(", ")}</span>}
            <span style={{background:sc.bg,border:`1px solid ${sc.border}`,borderRadius:5,padding:"0px 6px",color:sc.color,fontWeight:700,fontSize:10}}>{sc.label}</span>
            {photos.length>0&&<span style={{color:B.purple}}>📷 {photos.length}</span>}
          </div>
          {vts.length>0&&<ProgressBar value={done} max={vts.length}/>}
        </div>
        {managerMode&&total>0&&<div style={{textAlign:"right",flexShrink:0,marginRight:4}}>
          <div style={{fontSize:11,color:B.gray400}}>Total OS</div>
          <div style={{fontSize:14,fontWeight:800,color:B.amber}}>{fmtBRL(total)}</div>
          {(()=>{const bal=total-vehiclePaid(vehicle.id,payments); return bal>0
            ?<div style={{fontSize:10,color:B.red,fontWeight:700}}>Deve {fmtBRL(bal)}</div>
            :<div style={{fontSize:10,color:B.green,fontWeight:700}}>✓ Pago</div>;})()}
        </div>}
        {/* action buttons — wrapped grid of 4 per row, outside the header */}
        <div style={{display:"flex",gap:5,flexShrink:0}} onClick={e=>e.stopPropagation()}>
          <div style={{color:B.gray400}}>{open?<IChevU s={15}/>:<IChevD s={15}/>}</div>
        </div>
      </div>

      {/* Button bar — 4 per row, always visible */}
      <div style={{padding:"6px 10px",background:B.gray800,borderBottom:`1px solid ${B.gray700}66`,display:"flex",flexWrap:"wrap",gap:4}} onClick={e=>e.stopPropagation()}>
        {/* Row 1 — always shown */}
        {managerMode&&<button onClick={doPDF} disabled={pdfLoading} style={{background:pdfLoading?B.gray700:`${B.amber}22`,border:`1px solid ${B.amber}44`,borderRadius:6,padding:"4px 9px",cursor:pdfLoading?"wait":"pointer",color:pdfLoading?B.gray400:B.amber,display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,flex:"0 0 auto"}}>
          <IFileText s={12} c={pdfLoading?B.gray400:B.amber}/>{pdfLoading?"Gerando…":"PDF"}
        </button>}
        {managerMode&&<button onClick={()=>setSA(true)} style={{background:B.greenBg,border:`1px solid ${B.green}44`,borderRadius:6,padding:"4px 9px",cursor:"pointer",color:B.green,display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,flex:"0 0 auto"}}>
          <IBank s={12} c={B.green}/>Conta
        </button>}
        {managerMode&&<button onClick={copyLink} style={{background:cpLink?B.greenBg:B.purpleBg,border:`1px solid ${cpLink?B.green:B.purple}44`,borderRadius:6,padding:"4px 9px",cursor:"pointer",color:cpLink?B.green:B.purple,display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,flex:"0 0 auto"}}>
          <ILink s={12} c={cpLink?B.green:B.purple}/>{cpLink?"Copiado!":"Link"}
        </button>}
        <button onClick={()=>setSP(p=>!p)} style={{background:showPhotos?B.purpleBg:`${B.purple}15`,border:`1px solid ${B.purple}44`,borderRadius:6,padding:"4px 9px",cursor:"pointer",color:B.purple,display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,flex:"0 0 auto"}}>
          <IPhoto s={12} c={B.purple}/>Fotos
        </button>
        {/* Row 2 — manager buttons */}
        {!hideManagerButtons&&<button onClick={()=>setXfO(true)} style={{background:B.blueBg,border:`1px solid ${B.blue}44`,borderRadius:6,padding:"4px 9px",cursor:"pointer",color:B.blue,display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,flex:"0 0 auto"}}>
          <IUser s={12} c={B.blue}/>Cliente
        </button>}
        {!hideManagerButtons&&<button onClick={()=>setXfM(true)} style={{background:`${B.orange}22`,border:`1px solid ${B.orange}44`,borderRadius:6,padding:"4px 9px",cursor:"pointer",color:B.orange,display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,flex:"0 0 auto"}}>
          <IWrench s={12} c={B.orange}/>+ Mec.
        </button>}
        {!hideManagerButtons&&isOwner&&onSetStatus&&<>
          {vehicle.status!=="paused"&&<button onClick={()=>onSetStatus(vehicle.id,"paused")} style={{background:`${B.amber}22`,border:`1px solid ${B.amber}44`,borderRadius:6,padding:"4px 9px",cursor:"pointer",color:B.amber,display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,flex:"0 0 auto"}}>
            ⏸ Pausar
          </button>}
          {vehicle.status==="paused"&&<button onClick={()=>onSetStatus(vehicle.id,"active")} style={{background:B.greenBg,border:`1px solid ${B.green}44`,borderRadius:6,padding:"4px 9px",cursor:"pointer",color:B.green,display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,flex:"0 0 auto"}}>
            ▶ Retomar
          </button>}
          {vehicle.status!=="ready"&&<button onClick={()=>onSetStatus(vehicle.id,"ready")} style={{background:B.blueBg,border:`1px solid ${B.blue}44`,borderRadius:6,padding:"4px 9px",cursor:"pointer",color:B.blue,display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,flex:"0 0 auto"}}>
            ✓ Pronto
          </button>}
          {vehicle.status==="ready"&&<button onClick={()=>onSetStatus(vehicle.id,"active")} style={{background:`${B.orange}22`,border:`1px solid ${B.orange}44`,borderRadius:6,padding:"4px 9px",cursor:"pointer",color:B.orange,display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,flex:"0 0 auto"}}>
            ↩ Reabrir
          </button>}
        </>}
        {!hideManagerButtons&&<button onClick={()=>setConfirmDelV(true)} style={{background:`${B.red}15`,border:`1px solid ${B.red}33`,borderRadius:6,padding:"4px 9px",cursor:"pointer",color:B.red,display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,flex:"0 0 auto"}}
          onMouseEnter={e=>{e.currentTarget.style.background=`${B.red}33`;}} onMouseLeave={e=>{e.currentTarget.style.background=`${B.red}15`;}}>
          <ITrash s={12} c={B.red}/>Excluir
        </button>}
      </div>

      {/* Photos panel */}
      {showPhotos&&<div style={{padding:"12px 14px",background:B.black,borderBottom:`1px solid ${B.gray700}`}}>
        <div style={{fontSize:11,color:B.purple,fontWeight:700,marginBottom:4,textTransform:"uppercase",letterSpacing:.5}}>📷 Fotos da OS — visíveis ao cliente</div>
        <PhotoGallery photos={photos} onAdd={src=>onUpdateVehicle(vehicle.id,{photos:[...photos,src]})} onRemove={i=>onUpdateVehicle(vehicle.id,{photos:photos.filter((_,j)=>j!==i)})}/>
        <div style={{marginTop:10,borderTop:`1px solid ${B.gray700}`,paddingTop:10}}>
          <div style={{fontSize:11,color:B.orange,fontWeight:700,marginBottom:4,textTransform:"uppercase",letterSpacing:.5}}>🚗 Foto de identificação do veículo</div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {vehicle.photo?<img src={vehicle.photo} alt="" style={{width:80,height:60,objectFit:"cover",borderRadius:8,border:`1px solid ${B.gray600}`}}/>:null}
            <UploadBtn onFile={src=>onUpdateVehicle(vehicle.id,{photo:src})} folder="vehicles" label={vehicle.photo?"Trocar foto":"+ Adicionar foto do carro"}/>
            {vehicle.photo&&<button onClick={()=>onUpdateVehicle(vehicle.id,{photo:null})} style={{background:"none",border:"none",cursor:"pointer",color:B.gray500,fontSize:12}}><IX s={13}/></button>}
          </div>
        </div>
      </div>}

      {/* body */}
      {open&&<div style={{padding:"12px 14px"}}>
        {/* Paused banner */}
        {vehicle.status==="paused"&&<div style={{marginBottom:10,padding:"8px 12px",background:`${B.amber}18`,border:`1px solid ${B.amber}44`,borderRadius:8,display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:14}}>⏸</span>
          <span style={{fontSize:12.5,fontWeight:700,color:B.amber}}>Veículo pausado — aguardando cliente. Não trabalhe neste carro no momento.</span>
        </div>}
        {vts.length===0&&!aiS.length&&<p style={{fontSize:12.5,color:B.gray400,margin:"0 0 10px"}}>Nenhuma tarefa ainda.</p>}
        {vts.map(t=>managerMode
          ?<TaskItemManager key={t.id} task={t} defaultRate={defaultRate} stock={stock} employees={employees} onToggle={onToggleTask} onDelete={onDeleteTask} onUpdate={onUpdateTask} onConsumeStock={onConsumeStock} onReturnStock={onReturnStock}/>
          :<TaskItemMechanic key={t.id} task={t} employees={employees} onToggle={onToggleTask} onDelete={onDeleteTask} onUpdate={onUpdateTask}/>
        )}
        {aiS.length>0&&<div style={{marginTop:10,marginBottom:4}}>
          <div style={{fontSize:10,color:B.orange,fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>💡 Sugestões IA</div>
          {aiS.map((sg,i)=>(<button key={i} onClick={()=>{onAddTask(vehicle.id,sg);setAiS(p=>p.filter((_,j)=>j!==i));}}
            style={{display:"flex",alignItems:"center",gap:6,width:"100%",textAlign:"left",padding:"6px 10px",marginBottom:4,borderRadius:6,background:`${B.orange}15`,border:`1px dashed ${B.orange}66`,color:B.orangeL,fontSize:12.5,cursor:"pointer"}}>
            <IPlus s={12} c={B.orange}/>{sg}</button>))}
        </div>}
        <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
          <input value={newT} onChange={e=>setNewT(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addT()} placeholder="Nova tarefa…"
            style={{flex:1,minWidth:130,padding:"7px 11px",borderRadius:7,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none"}}/>
          <button onClick={addT} style={{padding:"7px 13px",borderRadius:7,background:B.orange,border:"none",color:B.white,cursor:"pointer",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",gap:5}}><IPlus s={14} c={B.white}/>Add</button>
          <button onClick={doAI} disabled={aiL} style={{padding:"7px 10px",borderRadius:7,background:aiL?B.gray700:`${B.orange}22`,border:`1px solid ${B.orange}55`,color:aiL?B.gray400:B.orange,cursor:aiL?"not-allowed":"pointer",fontWeight:600,fontSize:12,display:"flex",alignItems:"center",gap:4}}>
            <IAI s={13} c={aiL?B.gray400:B.orange}/>{aiL?"…":"IA"}
          </button>
        </div>
        {managerMode&&total>0&&<div style={{marginTop:10,padding:"8px 12px",background:B.amberBg,border:`1px solid ${B.amber}44`,borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:12,color:B.gray400}}>Total deste veículo</span>
          <span style={{fontSize:15,fontWeight:800,color:B.amber}}>{fmtBRL(total)}</span>
        </div>}
      </div>}
    </div>
    {xfM&&<TransferModal title="Adicionar Mecânico" subtitle={`${vehicle.model} — ${vehicle.plate}`}
      items={employees.filter(e=>!(vehicle.mechanicIds||[]).includes(e.id)).map(e=>({id:e.id,label:e.name,sub:e.phone,icon:<IWrench s={15} c={B.orange}/>}))}
      onPick={id=>{if(onAddMechanic)onAddMechanic(vehicle.id,id);else onTransferMechanic(vehicle.id,id);setXfM(false);}} onClose={()=>setXfM(false)}/>}
    {xfO&&<TransferModal title="Vincular / Transferir Cliente" subtitle={`${vehicle.model} — ${vehicle.plate}`}
      items={clients.filter(c=>c.id!==vehicle.clientId).map(c=>({id:c.id,label:c.name,sub:c.phone,icon:<IUser s={15} c={B.blue}/>}))}
      onPick={id=>{onTransferOwner(vehicle.id,id);setXfO(false);}} onClose={()=>setXfO(false)}/>}
    {showAccount&&<AccountModal vehicle={vehicle} tasks={tasks} payments={payments} defaultRate={defaultRate}
      onAddPayment={onAddPayment} onDeletePayment={onDeletePayment} onClose={()=>setSA(false)}/>}
    {confirmDelV&&<ConfirmModal title="Remover veículo?" message={<>Tem certeza que deseja remover <b style={{color:B.white}}>{vehicle.model} — {vehicle.plate}</b>? Todas as tarefas desta OS também serão removidas.</>} confirmLabel="Remover veículo" onConfirm={()=>{onDeleteVehicle(vehicle.id);setConfirmDelV(false);}} onCancel={()=>setConfirmDelV(false)}/>}
  </>);
}

// ─── EmployeeCard ─────────────────────────────────────────────────────────────
function EmployeeCard({employee,vehicles,tasks,employees,clients,stock,defaultRate,onAddVehicle,onDeleteVehicle,onTransferMechanic,onTransferOwner,onAddTask,onToggleTask,onDeleteTask,onUpdateTask,onUpdateVehicle,onConsumeStock,onReturnStock,onDelete,onSendWA,onUpdatePhone,onUpdateName,onAddMechanic,onRemoveMechanic,onSetStatus,isOwner=false}) {
  const [open,setOpen]=useState(false);
  const [showF,setSF]=useState(false);
  const [confirmDel,setConfirmDel]=useState(false);
  const [model,setMod]=useState(""); const [plate,setPlate]=useState("");
  const empV=[...vehicles.filter(v=>(v.mechanicIds||[v.employeeId]).includes(employee.id) && v.status!=="ready")]
    .sort((a,b)=>(a.status==="paused"?1:0)-(b.status==="paused"?1:0));
  const totT=tasks.filter(t=>empV.find(v=>v.id===t.vehicleId)).length;
  const donT=tasks.filter(t=>empV.find(v=>v.id===t.vehicleId)&&t.done).length;
  const addV=()=>{if(!model.trim()||!plate.trim())return;onAddVehicle(employee.id,model.trim(),plate.trim().toUpperCase());setMod("");setPlate("");setSF(false);};;
  return (<><div style={{background:B.gray800,borderRadius:14,border:`1px solid ${B.gray700}`,marginBottom:20,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,.35)"}}>
    <div style={{padding:"12px 16px",background:B.gray900,borderBottom:`2px solid ${B.orange}`,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
      <div style={{width:42,height:42,borderRadius:10,background:`${B.orange}22`,border:`1px solid ${B.orange}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><IWrench s={20} c={B.orange}/></div>
      <div style={{flex:1,minWidth:120}}>
        <InlineEdit value={employee.name} onSave={v=>onUpdateName(employee.id,v)} placeholder="Nome"/>
        <div style={{fontSize:12,color:B.gray400,marginTop:2}}>{empV.length} veículo{empV.length!==1?"s":""} · {donT}/{totT} tarefas {totT>0&&donT===totT?<span style={{color:B.green,fontWeight:700}}>✓</span>:""}</div>
        <div style={{display:"flex",alignItems:"center",gap:5,marginTop:3}}><IPhone s={12} c={employee.phone?B.wa:B.gray500}/><InlineEdit value={employee.phone} onSave={v=>onUpdatePhone(employee.id,v)} placeholder="+ WhatsApp"/></div>
      </div>
      <div style={{display:"flex",gap:5,flexShrink:0}}>
        <button onClick={()=>onSendWA(employee)} style={{padding:"7px 11px",borderRadius:8,border:"none",cursor:"pointer",fontWeight:700,fontSize:12,display:"flex",alignItems:"center",gap:4,background:employee.phone?B.wa:B.gray700,color:employee.phone?B.white:B.gray500}}>
          <IPhone s={13} c={employee.phone?B.white:B.gray500}/>{employee.phone?"WA":"Sem WA"}
        </button>
        <button onClick={()=>setConfirmDel(true)} style={{background:`${B.white}10`,border:"none",borderRadius:8,padding:7,cursor:"pointer",color:B.gray400,display:"flex"}}
          onMouseEnter={e=>{e.currentTarget.style.background="#ef444430";e.currentTarget.style.color=B.red;}}
          onMouseLeave={e=>{e.currentTarget.style.background=`${B.white}10`;e.currentTarget.style.color=B.gray400;}}><ITrash s={14}/></button>
        <button onClick={()=>setOpen(o=>!o)} style={{background:`${B.white}10`,border:"none",borderRadius:8,padding:7,cursor:"pointer",color:B.gray400,display:"flex"}}>{open?<IChevU s={14} c={B.gray400}/>:<IChevD s={14} c={B.gray400}/>}</button>
      </div>
    </div>
    {open&&<div style={{padding:"12px 16px"}}>
      {empV.length===0&&!showF&&<p style={{fontSize:13,color:B.gray400,marginBottom:10}}>Nenhum veículo.</p>}
      {empV.map(v=><VehicleCard key={v.id} vehicle={v} tasks={tasks} employees={employees} clients={clients} stock={stock} defaultRate={defaultRate} managerMode={false}
        onAddTask={onAddTask} onToggleTask={onToggleTask} onDeleteTask={onDeleteTask} onUpdateTask={onUpdateTask} onUpdateVehicle={onUpdateVehicle}
        onDeleteVehicle={onDeleteVehicle} onTransferMechanic={onTransferMechanic} onTransferOwner={onTransferOwner}
        onConsumeStock={onConsumeStock} onReturnStock={onReturnStock}
        onAddMechanic={onAddMechanic} onRemoveMechanic={onRemoveMechanic} onSetStatus={onSetStatus} isOwner={isOwner}/>)}
      {showF?<div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:4}}>
        <input value={model} onChange={e=>setMod(e.target.value)} placeholder="Modelo (ex: Honda Civic 2020)"
          style={{flex:"1 1 160px",padding:"7px 12px",borderRadius:7,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none"}}/>
        <input value={plate} onChange={e=>setPlate(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addV()} placeholder="Placa"
          style={{flex:"0 1 110px",padding:"7px 12px",borderRadius:7,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none",fontFamily:"monospace",letterSpacing:1}}/>
        <button onClick={addV} style={{padding:"7px 14px",borderRadius:7,background:B.orange,border:"none",color:B.white,cursor:"pointer",fontWeight:700}}>Salvar</button>
        <button onClick={()=>setSF(false)} style={{padding:"7px 10px",borderRadius:7,background:B.gray700,border:"none",color:B.gray200,cursor:"pointer"}}>✕</button>
      </div>:<button onClick={()=>setSF(true)} style={{marginTop:4,padding:"7px 12px",borderRadius:8,background:"transparent",border:`1px dashed ${B.orange}66`,color:B.orange,cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontWeight:600,fontSize:13}}
        onMouseEnter={e=>e.currentTarget.style.background=`${B.orange}15`} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
        <ICar s={13} c={B.orange}/>+ Veículo
      </button>}
    </div>}
  </div>
  {confirmDel&&<ConfirmModal title="Remover mecânico?" message={<>Tem certeza que deseja remover <b style={{color:B.white}}>{employee.name}</b>? Todos os veículos e tarefas associados também serão removidos.</>} confirmLabel="Remover mecânico" onConfirm={()=>{onDelete(employee.id);setConfirmDel(false);}} onCancel={()=>setConfirmDel(false)}/>}
  </>);
}

// ─── ClientCard ───────────────────────────────────────────────────────────────
function ClientCard({client,vehicles,tasks,employees,clients,stock,defaultRate,onUpdatePhone,onUpdateName,onUpdateEmail,onDelete,onSendWA,onTransferMechanic,onTransferOwner,onToggleTask,onDeleteTask,onAddTask,onUpdateTask,onUpdateVehicle,onDeleteVehicle,onConsumeStock,onReturnStock,payments=[],onAddPayment,onDeletePayment,company,onAddMechanic,onRemoveMechanic,onSetStatus,isOwner=false}) {
  const [open,setOpen]=useState(false);
  const [confirmDel,setConfirmDel]=useState(false);
  const cliV=vehicles.filter(v=>v.clientId===client.id);
  const totT=tasks.filter(t=>cliV.find(v=>v.id===t.vehicleId)).length;
  const donT=tasks.filter(t=>cliV.find(v=>v.id===t.vehicleId)&&t.done).length;
  const grand=cliV.reduce((s,v)=>s+tasks.filter(t=>t.vehicleId===v.id).reduce((ss,t)=>ss+taskCost(t,defaultRate).total,0),0);
  return (<><div style={{background:B.gray800,borderRadius:14,border:`1px solid ${B.gray700}`,marginBottom:20,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,.35)"}}>
    <div style={{padding:"12px 16px",background:B.gray900,borderBottom:`2px solid ${B.blue}`,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
      <div style={{width:42,height:42,borderRadius:10,background:B.blueBg,border:`1px solid ${B.blue}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><IUser s={22} c={B.blue}/></div>
      <div style={{flex:1,minWidth:120}}>
        <InlineEdit value={client.name} onSave={v=>onUpdateName(client.id,v)} placeholder="Nome"/>
        <div style={{fontSize:12,color:B.gray400,marginTop:2,display:"flex",gap:8,flexWrap:"wrap"}}>
          <span>{cliV.length} veículo{cliV.length!==1?"s":""}</span><span>·</span><span>{donT}/{totT} tarefas</span>
          {totT>0&&donT===totT&&<span style={{color:B.green,fontWeight:700}}>✓ Pronto!</span>}
          {grand>0&&<span style={{color:B.amber,fontWeight:700}}>💰 {fmtBRL(grand)}</span>}
        </div>
        {totT>0&&<ProgressBar value={donT} max={totT}/>}
        <div style={{display:"flex",alignItems:"center",gap:5,marginTop:3}}><IPhone s={12} c={client.phone?B.wa:B.gray500}/><InlineEdit value={client.phone} onSave={v=>onUpdatePhone(client.id,v)} placeholder="+ WhatsApp"/></div>
        <div style={{display:"flex",alignItems:"center",gap:5,marginTop:2}}>
          <span style={{fontSize:10,color:B.gray500}}>✉</span>
          <InlineEdit value={client.email||""} onSave={v=>onUpdateEmail(client.id,v)} placeholder="+ E-mail"/>
        </div>
      </div>
      <div style={{display:"flex",gap:5,flexShrink:0}}>
        <button onClick={()=>onSendWA(client)} style={{padding:"7px 11px",borderRadius:8,border:"none",cursor:"pointer",fontWeight:700,fontSize:12,display:"flex",alignItems:"center",gap:4,background:client.phone?B.wa:B.gray700,color:client.phone?B.white:B.gray500}}>
          <IPhone s={13} c={client.phone?B.white:B.gray500}/>{client.phone?"WA":"Sem WA"}
        </button>
        <button onClick={()=>setConfirmDel(true)} style={{background:`${B.white}10`,border:"none",borderRadius:8,padding:7,cursor:"pointer",color:B.gray400,display:"flex"}}
          onMouseEnter={e=>{e.currentTarget.style.background="#ef444430";e.currentTarget.style.color=B.red;}}
          onMouseLeave={e=>{e.currentTarget.style.background=`${B.white}10`;e.currentTarget.style.color=B.gray400;}}><ITrash s={14}/></button>
        <button onClick={()=>setOpen(o=>!o)} style={{background:`${B.white}10`,border:"none",borderRadius:8,padding:7,cursor:"pointer",color:B.gray400,display:"flex"}}>{open?<IChevU s={14} c={B.gray400}/>:<IChevD s={14} c={B.gray400}/>}</button>
      </div>
    </div>
    {open&&<div style={{padding:"12px 16px"}}>
      {cliV.length===0?<p style={{fontSize:13,color:B.gray400}}>Sem veículos. Vá à aba <b style={{color:B.orange}}>Mecânicos</b> → <b style={{color:B.blue}}>Cliente</b> no veículo.</p>
        :cliV.map(v=><VehicleCard key={v.id} vehicle={v} tasks={tasks} employees={employees} clients={clients} stock={stock} defaultRate={defaultRate} managerMode={true}
          onAddTask={onAddTask} onToggleTask={onToggleTask} onDeleteTask={onDeleteTask} onUpdateTask={onUpdateTask} onUpdateVehicle={onUpdateVehicle}
          onDeleteVehicle={onDeleteVehicle} onTransferMechanic={onTransferMechanic} onTransferOwner={onTransferOwner}
          onConsumeStock={onConsumeStock} onReturnStock={onReturnStock}
          payments={payments} onAddPayment={onAddPayment} onDeletePayment={onDeletePayment} company={company}
          onAddMechanic={onAddMechanic} onRemoveMechanic={onRemoveMechanic} onSetStatus={onSetStatus} isOwner={isOwner}/>)}
      {grand>0&&(()=>{const grandPaid=cliV.reduce((s,v)=>s+vehiclePaid(v.id,payments),0); const grandBal=grand-grandPaid; return (
        <div style={{marginTop:4,padding:"11px 16px",background:B.amberBg,border:`1px solid ${B.amber}55`,borderRadius:10,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
          <span style={{fontWeight:700,color:B.amber}}>💰 Total do cliente</span>
          <div style={{display:"flex",gap:14,alignItems:"center"}}>
            <span style={{fontSize:18,fontWeight:900,color:B.amber}}>{fmtBRL(grand)}</span>
            {grandBal>0?<span style={{fontSize:12,fontWeight:700,color:B.red}}>Deve {fmtBRL(grandBal)}</span>:<span style={{fontSize:12,fontWeight:700,color:B.green}}>✓ Pago</span>}
          </div>
        </div>);})()}
    </div>}
  </div>
  {confirmDel&&<ConfirmModal title="Remover cliente?" message={<>Tem certeza que deseja remover <b style={{color:B.white}}>{client.name}</b>? Os veículos dele serão desvinculados, mas não excluídos.</>} confirmLabel="Remover cliente" onConfirm={()=>{onDelete(client.id);setConfirmDel(false);}} onCancel={()=>setConfirmDel(false)}/>}
  </>);
}

// ─── StockTab ─────────────────────────────────────────────────────────────────
// ─── Account Current Modal (conta corrente da OS) ─────────────────────────────
function AccountModal({vehicle,tasks,payments,defaultRate,onAddPayment,onDeletePayment,onClose}) {
  const [amount,setAmount]=useState("");
  const [method,setMethod]=useState("Pix");
  const [date,setDate]=useState(new Date().toISOString().slice(0,10));
  const [note,setNote]=useState("");
  const [confirmDelPay,setConfirmDelPay]=useState(null);

  const total=vehicleTotal(vehicle.id,tasks,defaultRate);
  const vPayments=payments.filter(p=>p.vehicleId===vehicle.id).sort((a,b)=>a.paidAt<b.paidAt?1:-1);
  const paid=vPayments.reduce((s,p)=>s+p.amount,0);
  const balance=total-paid;

  const submit=()=>{
    const val=parseFloat(String(amount).replace(",","."));
    if(!val||val<=0)return;
    onAddPayment({vehicleId:vehicle.id,amount:val,method,paidAt:date,note});
    setAmount(""); setNote("");
  };

  return (<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:85,padding:16}} onClick={onClose}>
    <div style={{background:B.gray800,borderRadius:16,maxWidth:520,width:"100%",overflow:"hidden",border:`1px solid ${B.gray700}`,boxShadow:"0 24px 80px rgba(0,0,0,.7)",maxHeight:"90vh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
      <div style={{padding:"16px 20px",background:B.gray900,borderBottom:`2px solid ${B.green}`,display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <div style={{width:38,height:38,borderRadius:9,background:B.greenBg,display:"flex",alignItems:"center",justifyContent:"center"}}><IBank s={18} c={B.green}/></div>
        <div><div style={{fontWeight:700,fontSize:15,color:B.white}}>Conta Corrente — {vehicle.model}</div><div style={{fontSize:12,color:B.gray400}}>{vehicle.plate}</div></div>
        <button onClick={onClose} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:B.gray400}}><IX s={18}/></button>
      </div>

      <div style={{padding:20,overflowY:"auto",flex:1}}>
        {/* Summary */}
        <div style={{display:"flex",gap:8,marginBottom:18,flexWrap:"wrap"}}>
          <div style={{flex:"1 1 100px",background:B.gray700,borderRadius:10,padding:"10px 12px"}}>
            <div style={{fontSize:11,color:B.gray400}}>Total da OS</div>
            <div style={{fontSize:16,fontWeight:800,color:B.white}}>{fmtBRL(total)}</div>
          </div>
          <div style={{flex:"1 1 100px",background:B.greenBg,border:`1px solid ${B.green}44`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{fontSize:11,color:B.green}}>Pago</div>
            <div style={{fontSize:16,fontWeight:800,color:B.green}}>{fmtBRL(paid)}</div>
          </div>
          <div style={{flex:"1 1 100px",background:balance>0?`${B.red}18`:B.greenBg,border:`1px solid ${balance>0?B.red:B.green}44`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{fontSize:11,color:balance>0?B.red:B.green}}>{balance>0?"Saldo devedor":"Saldo"}</div>
            <div style={{fontSize:16,fontWeight:800,color:balance>0?B.red:B.green}}>{fmtBRL(Math.abs(balance))}</div>
          </div>
        </div>

        {/* New payment form */}
        <div style={{background:B.gray900,borderRadius:12,padding:14,marginBottom:18,border:`1px solid ${B.gray700}`}}>
          <div style={{fontSize:11,color:B.green,fontWeight:700,marginBottom:10,textTransform:"uppercase",letterSpacing:.5}}>+ Lançar pagamento</div>
          <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
            <input value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Valor (R$)" type="number" step="0.01"
              style={{flex:"1 1 110px",padding:"8px 11px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:13,outline:"none"}}/>
            <select value={method} onChange={e=>setMethod(e.target.value)} style={{flex:"1 1 110px",padding:"8px 11px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:13,outline:"none"}}>
              {["Pix","Dinheiro","Cartão débito","Cartão crédito","Transferência","Boleto","Outro"].map(m=><option key={m}>{m}</option>)}
            </select>
            <input value={date} onChange={e=>setDate(e.target.value)} type="date"
              style={{flex:"1 1 130px",padding:"8px 11px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:13,outline:"none"}}/>
          </div>
          <input value={note} onChange={e=>setNote(e.target.value)} placeholder="Observação (opcional)"
            style={{width:"100%",marginTop:7,padding:"8px 11px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
          <button onClick={submit} style={{marginTop:10,width:"100%",padding:"9px 0",borderRadius:8,background:B.green,border:"none",color:B.white,fontWeight:800,cursor:"pointer",fontSize:13}}>Registrar pagamento</button>
        </div>

        {/* History */}
        <div style={{fontSize:11,color:B.gray400,fontWeight:700,marginBottom:8,textTransform:"uppercase",letterSpacing:.5}}>Histórico de pagamentos</div>
        {vPayments.length===0?<div style={{textAlign:"center",padding:"16px 0",color:B.gray500,fontSize:13}}>Nenhum pagamento registrado ainda.</div>
          :vPayments.map(p=>(<div key={p.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",background:B.gray700,borderRadius:9,marginBottom:6}}>
            <div style={{width:34,height:34,borderRadius:8,background:B.greenBg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><ITrendUp s={15} c={B.green}/></div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:700,fontSize:13,color:B.white}}>{fmtBRL(p.amount)} <span style={{fontWeight:400,color:B.gray400,fontSize:11}}>· {p.method}</span></div>
              <div style={{fontSize:11,color:B.gray400}}>{new Date(p.paidAt+"T00:00:00").toLocaleDateString("pt-BR")}{p.note?` · ${p.note}`:""}</div>
            </div>
            <button onClick={()=>setConfirmDelPay(p.id)} style={{background:"none",border:"none",cursor:"pointer",color:B.gray500,padding:4,display:"flex",flexShrink:0}}
              onMouseEnter={e=>e.currentTarget.style.color=B.red} onMouseLeave={e=>e.currentTarget.style.color=B.gray500}><ITrash s={14}/></button>
          </div>))}
      </div>
    </div>
  {confirmDelPay&&<ConfirmModal title="Excluir pagamento?" message="Este pagamento será removido permanentemente do histórico desta OS." confirmLabel="Excluir pagamento" onConfirm={()=>{onDeletePayment(confirmDelPay);setConfirmDelPay(null);}} onCancel={()=>setConfirmDelPay(null)}/>}
  </div>);
}

function StockTab({stock,purchases,onAdd,onUpdate,onDelete,onAddPurchase,onUpdatePurchase,onDeletePurchase}) {
  const emptyForm = {name:"",brand:"",type:"",location:"",minQty:"",costPrice:"",markup:"",photo:""};
  const [form,setForm]=useState(emptyForm);
  const [showAdd,setShowAdd]=useState(false);
  const [search,setSearch]=useState("");
  const [filterType,setFT]=useState("");
  const [lightbox,setLB]=useState(null);
  const [openItem,setOpenItem]=useState(null);
  const [confirmDelete,setConfirmDelete]=useState(null);

  const types =[...new Set(stock.map(s=>s.type).filter(Boolean))].sort();
  const filtered=stock.filter(s=>
    (!search||s.name.toLowerCase().includes(search.toLowerCase()))&&
    (!filterType||s.type===filterType)
  );

  const salePrice=s=>Number(s.costPrice||0)*(1+Number(s.markup||0)/100);

  // New products start with qty 0 — stock is built up via "Adicionar Compra" afterwards.
  const addItem=()=>{
    if(!form.name.trim())return;
    const costPrice=Number(form.costPrice||0), markup=Number(form.markup||0), minQty=Math.max(0,Number(form.minQty||2));
    const sp=costPrice*(1+markup/100);
    onAdd({...form,qty:0,costPrice,markup,minQty,salePrice:sp});
    setForm(emptyForm);
    setShowAdd(false);
  };

  return (<div>
    {/* Filters */}
    <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
      <div style={{position:"relative",flex:"1 1 220px",maxWidth:320}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar produto por nome…"
          style={{width:"100%",padding:"8px 12px 8px 32px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
        <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:B.gray400}}><ISearch s={14}/></span>
      </div>
      <select value={filterType} onChange={e=>setFT(e.target.value)} style={{padding:"7px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray800,color:filterType?B.white:B.gray400,fontSize:13,outline:"none",cursor:"pointer"}}>
        <option value="">Todos os tipos</option>
        {types.map(t=><option key={t}>{t}</option>)}
      </select>
      {(search||filterType)&&<button onClick={()=>{setSearch("");setFT("");}} style={{padding:"7px 12px",borderRadius:8,background:B.gray700,border:`1px solid ${B.gray600}`,color:B.gray200,cursor:"pointer",fontSize:13}}>Limpar filtros</button>}
      <div style={{marginLeft:"auto"}}>
        <button onClick={()=>setShowAdd(p=>!p)} style={{padding:"8px 16px",borderRadius:8,background:B.purple,border:"none",color:B.white,cursor:"pointer",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",gap:6}}>
          <IPlus s={14} c={B.white}/>Novo produto
        </button>
      </div>
    </div>

    {/* Add form — basic product data only; stock starts at 0 */}
    {showAdd&&<div style={{background:B.gray800,borderRadius:12,border:`1px solid ${B.purple}55`,padding:18,marginBottom:20}}>
      <div style={{fontWeight:700,fontSize:12,color:B.purple,marginBottom:4,textTransform:"uppercase",letterSpacing:.6}}>Novo Produto</div>
      <div style={{fontSize:11.5,color:B.gray400,marginBottom:14}}>Cadastre os dados básicos. O saldo em estoque é zero até você lançar a primeira compra.</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {[
          {k:"name",ph:"Nome do produto",fl:"1 1 200px"},
          {k:"brand",ph:"Marca",fl:"1 1 130px"},
          {k:"type",ph:"Tipo/Categoria",fl:"1 1 130px"},
          {k:"location",ph:"Localização (ex: Prateleira A3)",fl:"1 1 180px"},
          {k:"minQty",ph:"Qtd mínima (ex: 2)",fl:"0 0 150px",tp:"number"},
          {k:"costPrice",ph:"Custo unitário (R$)",fl:"0 0 150px",tp:"number"},
          {k:"markup",ph:"Markup (ex: 100%)",fl:"0 0 140px",tp:"number"},
        ].map(f=><input key={f.k} value={form[f.k]} onChange={e=>setForm(p=>({...p,[f.k]:e.target.value}))} placeholder={f.ph} type={f.tp||"text"}
          style={{flex:f.fl,padding:"8px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none"}}/>)}
      </div>
      {/* preview sale price */}
      <div style={{marginTop:8,fontSize:12,color:B.gray400}}>
        Custo unitário: <b style={{color:B.white}}>{fmtBRL(form.costPrice||0)}</b> + markup {form.markup||0}% → Preço de venda: <b style={{color:B.amber}}>{fmtBRL(Number(form.costPrice||0)*(1+Number(form.markup||0)/100))}</b>
      </div>
      {/* Photo upload */}
      <div style={{marginTop:10,display:"flex",alignItems:"center",gap:10}}>
        {form.photo?<img src={form.photo} alt="" style={{width:60,height:60,objectFit:"cover",borderRadius:8,border:`1px solid ${B.gray600}`}}/>:null}
        <UploadBtn onFile={src=>setForm(p=>({...p,photo:src}))} folder="stock" label={form.photo?"Trocar foto":"+ Foto do produto"}/>
      </div>
      <div style={{display:"flex",gap:8,marginTop:14}}>
        <button onClick={addItem} style={{padding:"8px 20px",borderRadius:8,background:B.purple,border:"none",color:B.white,cursor:"pointer",fontWeight:800,fontSize:13}}>Cadastrar produto</button>
        <button onClick={()=>{setShowAdd(false);setForm(emptyForm);}} style={{padding:"8px 14px",borderRadius:8,background:B.gray700,border:"none",color:B.gray200,cursor:"pointer",fontSize:13}}>Cancelar</button>
      </div>
    </div>}

    {/* Stock list */}
    {filtered.length===0?<div style={{textAlign:"center",padding:"48px 0",color:B.gray400}}><div style={{fontSize:40,marginBottom:12}}>📦</div><div style={{fontWeight:700,color:B.gray200,marginBottom:4}}>Estoque vazio</div><div style={{fontSize:13}}>Adicione produtos clicando em "Novo produto".</div></div>
      :<div style={{display:"flex",flexDirection:"column",gap:8}}>
        {filtered.map(item=><StockRow key={item.id} item={item} salePrice={salePrice(item)} onLightbox={setLB} onOpen={()=>setOpenItem(item)}/>)}
      </div>}

    {lightbox&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.95)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setLB(null)}>
      <img src={lightbox} alt="" style={{maxWidth:"95vw",maxHeight:"95vh",objectFit:"contain",borderRadius:8}}/>
      <button onClick={()=>setLB(null)} style={{position:"fixed",top:16,right:16,background:"rgba(255,255,255,.1)",border:"none",borderRadius:99,padding:10,cursor:"pointer"}}><IX s={18} c={B.white}/></button>
    </div>}

    {openItem&&<StockProductPanel
      item={stock.find(s=>s.id===openItem.id)||openItem}
      purchases={purchases.filter(p=>p.stockId===openItem.id)}
      onSave={(id,patch)=>onUpdate(id,patch)}
      onDelete={id=>{onDelete(id);setOpenItem(null);}}
      onAddPurchase={onAddPurchase}
      onUpdatePurchase={onUpdatePurchase}
      onDeletePurchase={onDeletePurchase}
      onClose={()=>setOpenItem(null)}/>}
  </div>);
}

// ─── Stock row (list view) ────────────────────────────────────────────────────
function StockRow({item,salePrice,onLightbox,onOpen}) {
  const low=item.qty<=(item.minQty??2);
  return (<div style={{background:B.gray800,borderRadius:10,border:`1px solid ${low?B.red+"55":B.gray700}`,padding:"10px 14px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",cursor:"pointer"}} onClick={onOpen}>
    {/* photo thumb */}
    <div style={{width:48,height:48,borderRadius:8,background:B.gray700,flexShrink:0,cursor:item.photo?"pointer":"default",overflow:"hidden"}} onClick={e=>{e.stopPropagation();item.photo&&onLightbox(item.photo);}}>
      {item.photo?<img src={item.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
        :<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",opacity:.3}}><IBox s={20} c={B.white}/></div>}
    </div>

    {/* name + tags */}
    <div style={{flex:"1 1 160px",minWidth:0}}>
      <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
        <span style={{fontWeight:700,fontSize:13.5,color:B.white}}>{item.name}</span>
        {low&&<span style={{background:B.red,color:B.white,borderRadius:6,padding:"1px 7px",fontSize:10,fontWeight:700}}>⚠ Baixo</span>}
      </div>
      <div style={{fontSize:11,color:B.gray400,marginTop:2,display:"flex",gap:6,flexWrap:"wrap"}}>
        {item.brand&&<span style={{background:B.gray700,borderRadius:5,padding:"1px 7px"}}>{item.brand}</span>}
        {item.type&&<span style={{background:B.gray700,borderRadius:5,padding:"1px 7px"}}>{item.type}</span>}
        {item.location&&<span style={{background:B.gray700,borderRadius:5,padding:"1px 7px"}}>📍 {item.location}</span>}
      </div>
    </div>

    {/* saldo */}
    <div style={{textAlign:"center",flexShrink:0,minWidth:50}}>
      <div style={{fontSize:10,color:B.gray400}}>Saldo</div>
      <div style={{fontWeight:800,fontSize:15,color:low?B.red:B.white}}>{item.qty}</div>
    </div>

    {/* prices */}
    <div style={{display:"flex",gap:14,flexShrink:0}}>
      <div style={{textAlign:"right"}}><div style={{fontSize:10,color:B.gray400}}>Custo</div><div style={{fontSize:13,fontWeight:700,color:B.white}}>{fmtBRL(item.costPrice)}</div></div>
      <div style={{textAlign:"right"}}><div style={{fontSize:10,color:B.gray400}}>Markup</div><div style={{fontSize:13,fontWeight:700,color:B.white}}>{item.markup}%</div></div>
      <div style={{textAlign:"right"}}><div style={{fontSize:10,color:B.amber}}>Venda</div><div style={{fontSize:13,fontWeight:800,color:B.amber}}>{fmtBRL(salePrice)}</div></div>
    </div>

    {/* open button */}
    <button onClick={e=>{e.stopPropagation();onOpen();}} style={{padding:"7px 13px",borderRadius:8,background:B.purpleBg,border:`1px solid ${B.purple}44`,color:B.purple,cursor:"pointer",fontWeight:700,fontSize:12,display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
      <IEdit s={13} c={B.purple}/>Abrir
    </button>
  </div>);
}

// ─── Stock product panel: product data + purchase history ─────────────────────
function StockProductPanel({item,purchases,onSave,onDelete,onAddPurchase,onUpdatePurchase,onDeletePurchase,onClose}) {
  const [form,setForm]=useState({
    name:item.name, brand:item.brand, type:item.type, location:item.location||"",
    minQty:String(item.minQty??2), costPrice:String(item.costPrice), markup:String(item.markup), photo:item.photo||"",
  });
  const [showPurchaseForm,setShowPF]=useState(false);
  const [confirmDeleteProduct,setCDP]=useState(false);
  const salePrice=Number(form.costPrice||0)*(1+Number(form.markup||0)/100);

  const save=()=>{
    if(!form.name.trim())return;
    onSave(item.id,{
      name:form.name.trim(), brand:form.brand.trim(), type:form.type.trim(), location:form.location.trim(),
      minQty:Math.max(0,Number(form.minQty||0)), costPrice:Number(form.costPrice||0), markup:Number(form.markup||0),
      salePrice, photo:form.photo||null,
    });
  };

  const sortedPurchases=[...purchases].sort((a,b)=>a.purchaseDate<b.purchaseDate?1:-1);

  return (<>
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:90,padding:16}} onClick={onClose}>
      <div style={{background:B.gray800,borderRadius:16,maxWidth:560,width:"100%",overflow:"hidden",border:`1px solid ${B.purple}55`,boxShadow:"0 24px 80px rgba(0,0,0,.7)",maxHeight:"92vh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"16px 20px",background:B.gray900,borderBottom:`2px solid ${B.purple}`,display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
          <div style={{width:36,height:36,borderRadius:8,background:B.purpleBg,display:"flex",alignItems:"center",justifyContent:"center"}}><IBox s={17} c={B.purple}/></div>
          <div style={{fontWeight:700,fontSize:15,color:B.white}}>{item.name}</div>
          <button onClick={onClose} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:B.gray400}}><IX s={18}/></button>
        </div>

        <div style={{padding:20,overflowY:"auto",flex:1}}>
          {/* Saldo banner */}
          <div style={{display:"flex",gap:8,marginBottom:18}}>
            <div style={{flex:1,background:B.purpleBg,border:`1px solid ${B.purple}44`,borderRadius:10,padding:"10px 14px",textAlign:"center"}}>
              <div style={{fontSize:10,color:B.purple,fontWeight:700,textTransform:"uppercase"}}>Saldo atual</div>
              <div style={{fontSize:22,fontWeight:900,color:B.white}}>{item.qty}</div>
            </div>
            <div style={{flex:1,background:B.amberBg,border:`1px solid ${B.amber}44`,borderRadius:10,padding:"10px 14px",textAlign:"center"}}>
              <div style={{fontSize:10,color:B.amber,fontWeight:700,textTransform:"uppercase"}}>Preço de venda</div>
              <div style={{fontSize:18,fontWeight:900,color:B.amber}}>{fmtBRL(salePrice)}</div>
            </div>
          </div>

          {/* Product data form */}
          <div style={{fontSize:11,color:B.purple,fontWeight:700,marginBottom:10,textTransform:"uppercase",letterSpacing:.5}}>Dados do produto</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <Field label="Nome do produto">
              <input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="Ex: Pastilha de freio"
                style={{padding:"9px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"}}/>
            </Field>
            <div style={{display:"flex",gap:8}}>
              <Field label="Marca">
                <input value={form.brand} onChange={e=>setForm(p=>({...p,brand:e.target.value}))} placeholder="Ex: Bosch"
                  style={{padding:"9px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"}}/>
              </Field>
              <Field label="Tipo/Categoria">
                <input value={form.type} onChange={e=>setForm(p=>({...p,type:e.target.value}))} placeholder="Ex: Freios"
                  style={{padding:"9px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"}}/>
              </Field>
            </div>
            <div style={{display:"flex",gap:8}}>
              <Field label="Localização">
                <input value={form.location} onChange={e=>setForm(p=>({...p,location:e.target.value}))} placeholder="Ex: Prateleira A3"
                  style={{padding:"9px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"}}/>
              </Field>
              <Field label="Qtd mínima" flex="0 0 130px">
                <input value={form.minQty} onChange={e=>setForm(p=>({...p,minQty:Math.max(0,Number(e.target.value||0))}))} placeholder="Ex: 2" type="number" min="0"
                  style={{padding:"9px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"}}/>
              </Field>
            </div>
            <div style={{display:"flex",gap:8}}>
              <Field label="Custo unitário (R$)">
                <input value={form.costPrice} onChange={e=>setForm(p=>({...p,costPrice:e.target.value}))} placeholder="0,00" type="number"
                  style={{padding:"9px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"}}/>
              </Field>
              <Field label="Markup (%)">
                <input value={form.markup} onChange={e=>setForm(p=>({...p,markup:e.target.value}))} placeholder="Ex: 100" type="number"
                  style={{padding:"9px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"}}/>
              </Field>
            </div>
            <div style={{fontSize:11.5,color:B.gray500}}>O custo unitário é usado para calcular o preço de venda. Ele não muda sozinho quando você lança uma nova compra — ajuste aqui manualmente se necessário.</div>
            <Field label="Foto do produto">
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                {form.photo?<img src={form.photo} alt="" style={{width:56,height:56,objectFit:"cover",borderRadius:8,border:`1px solid ${B.gray600}`}}/>:null}
                <UploadBtn onFile={src=>setForm(p=>({...p,photo:src}))} folder="stock" label={form.photo?"Trocar foto":"+ Foto do produto"}/>
                {form.photo&&<button onClick={()=>setForm(p=>({...p,photo:""}))} style={{background:"none",border:"none",cursor:"pointer",color:B.gray500}}><IX s={14}/></button>}
              </div>
            </Field>
          </div>
          <div style={{display:"flex",gap:8,marginTop:14}}>
            <button onClick={save} style={{flex:1,padding:"9px 0",borderRadius:9,background:B.purple,border:"none",color:B.white,fontWeight:800,cursor:"pointer",fontSize:13}}>Salvar dados do produto</button>
            <button onClick={()=>setCDP(true)} style={{padding:"9px 14px",borderRadius:9,background:"transparent",border:`1px solid ${B.red}44`,color:B.red,cursor:"pointer",fontWeight:600,fontSize:12,display:"flex",alignItems:"center",gap:5}}>
              <ITrash s={13} c={B.red}/>Remover
            </button>
          </div>

          {/* Purchase history */}
          <div style={{marginTop:24,paddingTop:18,borderTop:`1px solid ${B.gray700}`}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <div style={{fontSize:11,color:B.green,fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>Histórico de compras</div>
              <button onClick={()=>setShowPF(p=>!p)} style={{padding:"6px 12px",borderRadius:8,background:B.greenBg,border:`1px solid ${B.green}44`,color:B.green,cursor:"pointer",fontWeight:700,fontSize:12,display:"flex",alignItems:"center",gap:5}}>
                <IPlus s={13} c={B.green}/>Adicionar Compra
              </button>
            </div>

            {showPurchaseForm&&<PurchaseForm stockId={item.id} onConfirm={(p)=>{onAddPurchase(p);setShowPF(false);}} onCancel={()=>setShowPF(false)}/>}

            {sortedPurchases.length===0?<div style={{textAlign:"center",padding:"16px 0",color:B.gray500,fontSize:13}}>Nenhuma compra registrada ainda.</div>
              :<div style={{display:"flex",flexDirection:"column",gap:6}}>
                {sortedPurchases.map(p=><PurchaseRow key={p.id} purchase={p} onUpdate={onUpdatePurchase} onDelete={onDeletePurchase}/>)}
              </div>}
          </div>
        </div>
      </div>
    </div>

    {confirmDeleteProduct&&<ConfirmModal
      title="Remover produto?"
      message={<>Tem certeza que deseja remover <b style={{color:B.white}}>{item.name}</b> do estoque? Esta ação não pode ser desfeita, mas o histórico de compras já lançado é preservado para referência.</>}
      confirmLabel="Remover produto"
      onConfirm={()=>{onDelete(item.id);setCDP(false);}}
      onCancel={()=>setCDP(false)}/>}
  </>);
}

// ─── Purchase row — view or edit mode ──────────────────────────────────────────
function PurchaseRow({purchase,onUpdate,onDelete}) {
  const [editing,setEditing]=useState(false);
  const [confirmDel,setConfirmDel]=useState(false);
  const [form,setForm]=useState({
    purchaseDate:purchase.purchaseDate, supplier:purchase.supplier,
    qty:String(purchase.qty), unitCost:String(purchase.unitCost), invoiceNumber:purchase.invoiceNumber,
  });

  const qtyNum=Number(form.qty||0), unitCostNum=Number(form.unitCost||0);
  const total=qtyNum*unitCostNum;

  const save=()=>{
    if(qtyNum<=0||unitCostNum<=0)return;
    onUpdate(purchase.id,{purchaseDate:form.purchaseDate,supplier:form.supplier.trim(),qty:qtyNum,unitCost:unitCostNum,totalCost:total,invoiceNumber:form.invoiceNumber.trim()});
    setEditing(false);
  };
  const cancel=()=>{
    setForm({purchaseDate:purchase.purchaseDate,supplier:purchase.supplier,qty:String(purchase.qty),unitCost:String(purchase.unitCost),invoiceNumber:purchase.invoiceNumber});
    setEditing(false);
  };

  if(editing) return (<>
    <div style={{background:B.gray700,borderRadius:9,padding:"12px",border:`1px solid ${B.purple}55`}}>
      <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
        <Field label="Data da compra" flex="1 1 130px">
          <input value={form.purchaseDate} onChange={e=>setForm(p=>({...p,purchaseDate:e.target.value}))} type="date"
            style={{padding:"7px 10px",borderRadius:7,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:12.5,outline:"none",width:"100%",boxSizing:"border-box"}}/>
        </Field>
        <Field label="Fornecedor" flex="1 1 140px">
          <input value={form.supplier} onChange={e=>setForm(p=>({...p,supplier:e.target.value}))} placeholder="Fornecedor"
            style={{padding:"7px 10px",borderRadius:7,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:12.5,outline:"none",width:"100%",boxSizing:"border-box"}}/>
        </Field>
        <Field label="Número da NF" flex="1 1 110px">
          <input value={form.invoiceNumber} onChange={e=>setForm(p=>({...p,invoiceNumber:e.target.value}))} placeholder="NF"
            style={{padding:"7px 10px",borderRadius:7,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:12.5,outline:"none",width:"100%",boxSizing:"border-box"}}/>
        </Field>
      </div>
      <div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:7}}>
        <Field label="Quantidade" flex="1 1 100px">
          <input value={form.qty} onChange={e=>setForm(p=>({...p,qty:e.target.value}))} type="number"
            style={{padding:"7px 10px",borderRadius:7,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:12.5,outline:"none",width:"100%",boxSizing:"border-box"}}/>
        </Field>
        <Field label="Custo unitário (R$)" flex="1 1 140px">
          <input value={form.unitCost} onChange={e=>setForm(p=>({...p,unitCost:e.target.value}))} type="number"
            style={{padding:"7px 10px",borderRadius:7,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:12.5,outline:"none",width:"100%",boxSizing:"border-box"}}/>
        </Field>
        <Field label="Custo total" flex="1 1 120px">
          <div style={{padding:"7px 10px",borderRadius:7,background:B.amberBg,border:`1px solid ${B.amber}44`,fontSize:12.5,fontWeight:800,color:B.amber}}>{fmtBRL(total)}</div>
        </Field>
      </div>
      <div style={{display:"flex",gap:7,marginTop:10}}>
        <button onClick={save} style={{flex:1,padding:"7px 0",borderRadius:7,background:B.green,border:"none",color:B.white,fontWeight:700,cursor:"pointer",fontSize:12}}>Salvar</button>
        <button onClick={cancel} style={{padding:"7px 12px",borderRadius:7,background:B.gray800,border:`1px solid ${B.gray600}`,color:B.gray200,cursor:"pointer",fontWeight:600,fontSize:12}}>Cancelar</button>
        <button onClick={()=>setConfirmDel(true)} style={{padding:"7px 12px",borderRadius:7,background:"transparent",border:`1px solid ${B.red}44`,color:B.red,cursor:"pointer",fontWeight:600,fontSize:12,display:"flex",alignItems:"center",gap:4}}>
          <ITrash s={12} c={B.red}/>Excluir
        </button>
      </div>
    </div>
    {confirmDel&&<ConfirmModal title="Excluir compra?"
      message="Esta compra será removida do histórico permanentemente. O saldo do produto não será ajustado automaticamente — revise a quantidade em estoque depois, se necessário."
      confirmLabel="Excluir compra"
      onConfirm={()=>{onDelete(purchase.id);setConfirmDel(false);}}
      onCancel={()=>setConfirmDel(false)}/>}
  </>);

  return (<div style={{background:B.gray700,borderRadius:9,padding:"9px 12px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
    <div style={{width:30,height:30,borderRadius:7,background:B.greenBg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><IBank s={14} c={B.green}/></div>
    <div style={{flex:"1 1 140px",minWidth:0}}>
      <div style={{fontSize:12.5,fontWeight:700,color:B.white}}>{purchase.qty}x · {fmtBRL(purchase.unitCost)} cada · {fmtBRL(purchase.totalCost)} total</div>
      <div style={{fontSize:11,color:B.gray400}}>{new Date(purchase.purchaseDate+"T00:00:00").toLocaleDateString("pt-BR")}{purchase.supplier?` · ${purchase.supplier}`:""}{purchase.invoiceNumber?` · NF ${purchase.invoiceNumber}`:""}</div>
    </div>
    <button onClick={()=>setEditing(true)} style={{padding:"5px 10px",borderRadius:7,background:B.purpleBg,border:`1px solid ${B.purple}44`,color:B.purple,cursor:"pointer",fontWeight:600,fontSize:11,display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
      <IEdit s={11} c={B.purple}/>Editar
    </button>
  </div>);
}

// ─── Purchase form (creates an immutable purchase record) ─────────────────────
function PurchaseForm({stockId,onConfirm,onCancel}) {
  const [date,setDate]=useState(new Date().toISOString().slice(0,10));
  const [supplier,setSupplier]=useState("");
  const [qty,setQty]=useState("");
  const [unitCost,setUnitCost]=useState("");
  const [invoice,setInvoice]=useState("");

  const qtyNum=Number(qty||0), unitCostNum=Number(unitCost||0);
  const total=qtyNum*unitCostNum;

  const confirm=()=>{
    if(qtyNum<=0||unitCostNum<=0)return;
    onConfirm({stockId,purchaseDate:date,supplier:supplier.trim(),qty:qtyNum,unitCost:unitCostNum,totalCost:total,invoiceNumber:invoice.trim()});
  };

  return (<div style={{background:B.gray900,borderRadius:12,padding:14,marginBottom:14,border:`1px solid ${B.green}44`}}>
    <div style={{fontSize:11,color:B.green,fontWeight:700,marginBottom:10,textTransform:"uppercase",letterSpacing:.5}}>Nova compra</div>
    <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
      <Field label="Data da compra" flex="1 1 130px">
        <input value={date} onChange={e=>setDate(e.target.value)} type="date"
          style={{padding:"8px 11px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"}}/>
      </Field>
      <Field label="Fornecedor" flex="1 1 150px">
        <input value={supplier} onChange={e=>setSupplier(e.target.value)} placeholder="Nome do fornecedor"
          style={{padding:"8px 11px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"}}/>
      </Field>
      <Field label="Número da NF" flex="1 1 120px">
        <input value={invoice} onChange={e=>setInvoice(e.target.value)} placeholder="Ex: 12345"
          style={{padding:"8px 11px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"}}/>
      </Field>
    </div>
    <div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:7}}>
      <Field label="Quantidade" flex="1 1 110px">
        <input value={qty} onChange={e=>setQty(e.target.value)} placeholder="Ex: 10" type="number"
          style={{padding:"8px 11px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"}}/>
      </Field>
      <Field label="Custo unitário (R$)" flex="1 1 150px">
        <input value={unitCost} onChange={e=>setUnitCost(e.target.value)} placeholder="0,00" type="number"
          style={{padding:"8px 11px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"}}/>
      </Field>
      <Field label="Custo total" flex="1 1 140px">
        <div style={{padding:"8px 11px",borderRadius:8,background:B.amberBg,border:`1px solid ${B.amber}44`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:13,fontWeight:800,color:B.amber}}>{fmtBRL(total)}</span>
        </div>
      </Field>
    </div>
    <div style={{fontSize:11,color:B.gray500,marginTop:8}}>Depois de confirmado, este lançamento fica travado para conferência futura — mas pode ser editado depois clicando em "Editar".</div>
    <div style={{display:"flex",gap:8,marginTop:10}}>
      <button onClick={confirm} disabled={qtyNum<=0||unitCostNum<=0} style={{flex:1,padding:"9px 0",borderRadius:8,background:(qtyNum<=0||unitCostNum<=0)?B.gray700:B.green,border:"none",color:B.white,fontWeight:800,cursor:(qtyNum<=0||unitCostNum<=0)?"not-allowed":"pointer",fontSize:13}}>Confirmar lançamento</button>
      <button onClick={onCancel} style={{padding:"9px 14px",borderRadius:8,background:B.gray700,border:`1px solid ${B.gray600}`,color:B.gray200,cursor:"pointer",fontWeight:600,fontSize:12}}>Cancelar</button>
    </div>
  </div>);
}

// ─── Clients Monitor Tab ──────────────────────────────────────────────────────
function ClientsMonitorTab({clients,vehicles,tasks,employees,defaultRate,onUpdateName,onUpdatePhone,onUpdateEmail,onDelete}) {
  const [search,setSearch]=useState("");
  const [open,setOpen]=useState(null); // id of expanded client
  const [confirmDel,setConfirmDel]=useState(null);

  const filtered=clients.filter(c=>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone||"").includes(search) ||
    (c.email||"").toLowerCase().includes(search.toLowerCase())
  ).sort((a,b)=>a.name.localeCompare(b.name,"pt-BR"));

  return (<div>
    <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center"}}>
      <div style={{position:"relative",flex:"1 1 260px",maxWidth:360}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por nome, telefone ou e-mail…"
          style={{width:"100%",padding:"8px 12px 8px 32px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
        <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:B.gray400}}><ISearch s={14}/></span>
        {search&&<button onClick={()=>setSearch("")} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:B.gray400}}><IX s={13}/></button>}
      </div>
      <div style={{fontSize:11,color:B.gray400,marginLeft:"auto"}}>{filtered.length} cliente{filtered.length!==1?"s":""}</div>
    </div>

    {filtered.length===0?
      <div style={{textAlign:"center",padding:"56px 0",color:B.gray400}}>
        <div style={{fontSize:40,marginBottom:12}}>👤</div>
        <div style={{fontWeight:700,color:B.gray200}}>{search?"Nenhum cliente encontrado":"Nenhum cliente cadastrado"}</div>
      </div>
    :<div style={{display:"flex",flexDirection:"column",gap:8}}>
      {filtered.map(cli=>{
        const cliVs=vehicles.filter(v=>v.clientId===cli.id);
        const totalTasks=tasks.filter(t=>cliVs.find(v=>v.id===t.vehicleId)).length;
        const doneTasks =tasks.filter(t=>cliVs.find(v=>v.id===t.vehicleId)&&t.done).length;
        const totalValue=cliVs.reduce((s,v)=>s+tasks.filter(t=>t.vehicleId===v.id).reduce((ss,t)=>ss+taskCost(t,defaultRate).total,0),0);
        const isOpen=open===cli.id;

        return (<div key={cli.id} style={{background:B.gray800,borderRadius:12,border:`1px solid ${B.gray700}`,overflow:"hidden"}}>
          {/* Header */}
          <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",cursor:"pointer",background:B.gray900}} onClick={()=>setOpen(isOpen?null:cli.id)}>
            <div style={{width:40,height:40,borderRadius:10,background:B.blueBg,border:`1px solid ${B.blue}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <IUser s={20} c={B.blue}/>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:700,fontSize:14,color:B.white}}>{cli.name}</div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:2}}>
                {cli.phone&&<span style={{fontSize:11,color:B.wa}}>📱 {cli.phone}</span>}
                {cli.email&&<span style={{fontSize:11,color:B.gray400}}>✉ {cli.email}</span>}
              </div>
            </div>
            <div style={{textAlign:"right",flexShrink:0,marginRight:6}}>
              <div style={{fontSize:11,color:B.gray400}}>{cliVs.length} veículo{cliVs.length!==1?"s":" "}· {doneTasks}/{totalTasks} tarefas</div>
              {totalValue>0&&<div style={{fontSize:13,fontWeight:800,color:B.amber}}>{fmtBRL(totalValue)}</div>}
            </div>
            <div style={{color:B.gray400,flexShrink:0}}>{isOpen?<IChevU s={15}/>:<IChevD s={15}/>}</div>
          </div>

          {/* Expanded details */}
          {isOpen&&<div style={{padding:"14px 16px"}}>
            {/* Editable fields */}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
              <div style={{flex:"1 1 160px",background:B.gray700,borderRadius:8,padding:"8px 12px"}}>
                <FieldLabel>Nome</FieldLabel>
                <InlineEdit value={cli.name} onSave={v=>onUpdateName(cli.id,v)} placeholder="Nome"/>
              </div>
              <div style={{flex:"1 1 160px",background:B.gray700,borderRadius:8,padding:"8px 12px"}}>
                <FieldLabel>WhatsApp</FieldLabel>
                <InlineEdit value={cli.phone||""} onSave={v=>onUpdatePhone(cli.id,v)} placeholder="+ Adicionar"/>
              </div>
              <div style={{flex:"1 1 180px",background:B.gray700,borderRadius:8,padding:"8px 12px"}}>
                <FieldLabel>E-mail</FieldLabel>
                <InlineEdit value={cli.email||""} onSave={v=>onUpdateEmail(cli.id,v)} placeholder="+ Adicionar"/>
              </div>
            </div>

            {/* Vehicle history */}
            <div style={{fontSize:10,color:B.blue,fontWeight:700,marginBottom:8,textTransform:"uppercase",letterSpacing:.5}}>🚗 Veículos</div>
            {cliVs.length===0?<div style={{fontSize:13,color:B.gray400,textAlign:"center",padding:"12px 0"}}>Nenhum veículo vinculado.</div>
            :<div style={{display:"flex",flexDirection:"column",gap:6}}>
              {cliVs.map(v=>{
                const vts=tasks.filter(t=>t.vehicleId===v.id);
                const vDone=vts.filter(t=>t.done);
                const vTotal=vts.reduce((s,t)=>s+taskCost(t,defaultRate).total,0);
                const emp=employees.find(e=>e.id===v.employeeId);
                return (<div key={v.id} style={{background:B.gray700,borderRadius:9,padding:"10px 12px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  {v.photo?<img src={v.photo} alt="" style={{width:38,height:38,borderRadius:7,objectFit:"cover",flexShrink:0}}/>
                    :<div style={{width:38,height:38,borderRadius:7,background:`${B.orange}22`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><ICar s={17} c={B.orange}/></div>}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                      <span style={{fontWeight:700,fontSize:13,color:B.white}}>{v.model}</span>
                      <span style={{fontFamily:"monospace",fontSize:11,color:B.gray400}}>{v.plate}</span>
                      {v.osNumber&&<span style={{background:`${B.orange}22`,color:B.orange,borderRadius:5,padding:"0px 6px",fontWeight:700,fontSize:10}}>{fmtOS(v.osNumber)}</span>}
                    </div>
                    <div style={{fontSize:11,color:B.gray400,marginTop:2}}>
                      {emp&&<span>🔧 {emp.name} · </span>}
                      <span>{vDone.length}/{vts.length} serviços</span>
                    </div>
                    {vts.length>0&&<ProgressBar value={vDone.length} max={vts.length}/>}
                  </div>
                  {vTotal>0&&<div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:10,color:B.gray400}}>Total</div>
                    <div style={{fontSize:13,fontWeight:800,color:B.amber}}>{fmtBRL(vTotal)}</div>
                  </div>}
                </div>);
              })}
            </div>}

            {/* Action buttons */}
            <div style={{display:"flex",gap:8,marginTop:14}}>
              {cli.phone&&<button onClick={()=>{}} style={{padding:"7px 14px",borderRadius:8,background:B.wa,border:"none",color:B.white,fontWeight:700,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
                <IPhone s={13} c={B.white}/>WhatsApp
              </button>}
              <button onClick={()=>setConfirmDel(cli.id)} style={{marginLeft:"auto",padding:"7px 12px",borderRadius:8,background:"transparent",border:`1px solid ${B.red}44`,color:B.red,cursor:"pointer",fontWeight:600,fontSize:12,display:"flex",alignItems:"center",gap:5}}>
                <ITrash s={13} c={B.red}/>Remover cliente
              </button>
            </div>
          </div>}
        </div>);
      })}
    </div>}

    {confirmDel&&<ConfirmModal title="Remover cliente?"
      message={<>Tem certeza que deseja remover <b style={{color:B.white}}>{clients.find(c=>c.id===confirmDel)?.name}</b>? Os veículos serão desvinculados, mas não excluídos.</>}
      confirmLabel="Remover cliente"
      onConfirm={()=>{onDelete(confirmDel);setConfirmDel(null);}}
      onCancel={()=>setConfirmDel(null)}/>}
  </div>);
}

// ─── Vehicles Tab ─────────────────────────────────────────────────────────────
function VehiclesTab({vehicles,tasks,employees,clients,defaultRate,onUpdateVehicle}) {
  const [search,setSearch]=useState("");
  const [now,setNow]=useState(Date.now());

  // Tick every minute to keep elapsed time fresh
  useEffect(()=>{
    const t=setInterval(()=>setNow(Date.now()),60000);
    return ()=>clearInterval(t);
  },[]);

  const filtered=vehicles.filter(v=>
    !search ||
    v.model.toLowerCase().includes(search.toLowerCase()) ||
    v.plate.toLowerCase().includes(search.toLowerCase()) ||
    (clients.find(c=>c.id===v.clientId)?.name||"").toLowerCase().includes(search.toLowerCase())
  );

  // Sort: vehicles with enteredAt first (most time in shop at top), then by createdAt
  const sorted=[...filtered].sort((a,b)=>{
    if(a.enteredAt && b.enteredAt) return new Date(a.enteredAt)-new Date(b.enteredAt);
    if(a.enteredAt) return -1;
    if(b.enteredAt) return 1;
    return 0;
  });

  return (<div>
    {/* Search bar */}
    <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center"}}>
      <div style={{position:"relative",flex:1,maxWidth:340}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por modelo, placa ou cliente…"
          style={{width:"100%",padding:"8px 12px 8px 32px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
        <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:B.gray400}}><ISearch s={14}/></span>
        {search&&<button onClick={()=>setSearch("")} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:B.gray400}}><IX s={13}/></button>}
      </div>
      <div style={{marginLeft:"auto",fontSize:11,color:B.gray400}}>{sorted.length} veículo{sorted.length!==1?"s":""}</div>
    </div>

    {sorted.length===0?
      <div style={{textAlign:"center",padding:"56px 0",color:B.gray400}}>
        <div style={{fontSize:40,marginBottom:12}}>🚗</div>
        <div style={{fontWeight:700,color:B.gray200,marginBottom:4}}>{search?"Nenhum veículo encontrado":"Nenhum veículo cadastrado"}</div>
        <div style={{fontSize:13}}>Veículos são criados na aba <b style={{color:B.orange}}>Mecânicos</b>.</div>
      </div>
    :<div style={{display:"flex",flexDirection:"column",gap:10}}>
      {sorted.map(v=><VehicleHistoryCard key={v.id} vehicle={v} tasks={tasks} employees={employees} clients={clients} defaultRate={defaultRate} onUpdateVehicle={onUpdateVehicle} now={now}/>)}
    </div>}
  </div>);
}

function VehicleHistoryCard({vehicle,tasks,employees,clients,defaultRate,onUpdateVehicle,now}) {
  const [open,setOpen]=useState(false);
  const [editEntry,setEditEntry]=useState(false);
  const [entryInput,setEntryInput]=useState(vehicle.enteredAt?new Date(vehicle.enteredAt).toISOString().slice(0,16):"");

  const vts    = tasks.filter(t=>t.vehicleId===vehicle.id);
  const done   = vts.filter(t=>t.done);
  const pending= vts.filter(t=>!t.done);
  const emp    = employees.find(e=>e.id===vehicle.employeeId);
  const cli    = clients.find(c=>c.id===vehicle.clientId);
  const elapsed= vehicle.enteredAt ? elapsedTime(vehicle.enteredAt) : null;
  const total  = vts.reduce((s,t)=>s+taskCost(t,defaultRate).total,0);
  const doneCost=done.reduce((s,t)=>s+taskCost(t,defaultRate).total,0);

  const saveEntry=()=>{
    const val=entryInput?new Date(entryInput).toISOString():null;
    onUpdateVehicle(vehicle.id,{enteredAt:val});
    setEditEntry(false);
  };
  const clearEntry=()=>{ onUpdateVehicle(vehicle.id,{enteredAt:null}); setEntryInput(""); setEditEntry(false); };

  return (<div style={{background:B.gray800,borderRadius:12,border:`1px solid ${B.gray700}`,overflow:"hidden"}}>
    {/* Header row */}
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",cursor:"pointer",background:B.gray900}} onClick={()=>setOpen(o=>!o)}>
      {vehicle.photo
        ?<img src={vehicle.photo} alt="" style={{width:42,height:42,borderRadius:8,objectFit:"cover",flexShrink:0,border:`1px solid ${B.gray700}`}}/>
        :<div style={{width:42,height:42,borderRadius:8,background:`${B.orange}22`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><ICar s={19} c={B.orange}/></div>}

      <div style={{flex:1,minWidth:0}}>
        <div style={{fontWeight:700,fontSize:13.5,color:B.white,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{vehicle.model}</div>
        <div style={{fontSize:11,color:B.gray400,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginTop:1}}>
          <span style={{fontFamily:"monospace",letterSpacing:.5}}>{vehicle.plate}</span>
          {vehicle.osNumber&&<span style={{background:`${B.orange}22`,color:B.orange,borderRadius:5,padding:"0px 6px",fontWeight:700,fontSize:10}}>{fmtOS(vehicle.osNumber)}</span>}
          {cli&&<span style={{color:B.blue}}>👤 {cli.name}</span>}
          {emp&&<span style={{color:B.orange}}>🔧 {emp.name}</span>}
        </div>
        {vts.length>0&&<ProgressBar value={done.length} max={vts.length}/>}
      </div>

      {/* Elapsed time badge */}
      <div style={{flexShrink:0,textAlign:"right",marginRight:4}}>
        {elapsed
          ?<div style={{background:`${elapsed.color}18`,border:`1px solid ${elapsed.color}44`,borderRadius:8,padding:"4px 10px",textAlign:"center"}}>
              <div style={{fontSize:9,color:elapsed.color,fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>Na oficina</div>
              <div style={{fontSize:13,fontWeight:800,color:elapsed.color}}>{elapsed.label}</div>
            </div>
          :<button onClick={e=>{e.stopPropagation();setEditEntry(true);}} style={{background:B.gray700,border:`1px dashed ${B.gray600}`,borderRadius:8,padding:"4px 10px",cursor:"pointer",color:B.gray400,fontSize:11,fontWeight:600}}>
              + Registrar entrada
            </button>}
      </div>

      {/* Task summary */}
      {vts.length>0&&<div style={{flexShrink:0,textAlign:"right",marginRight:4}}>
        <div style={{fontSize:10,color:B.gray400}}>Serviços</div>
        <div style={{fontSize:12,fontWeight:700,color:B.white}}>{done.length}/{vts.length}</div>
        {total>0&&<div style={{fontSize:11,fontWeight:800,color:B.amber}}>{fmtBRL(total)}</div>}
      </div>}

      <div style={{color:B.gray400,flexShrink:0}}>{open?<IChevU s={15}/>:<IChevD s={15}/>}</div>
    </div>

    {/* Expanded content */}
    {open&&<div style={{padding:"14px 16px"}}>

      {/* Entry time editor */}
      {(editEntry||vehicle.enteredAt)&&<div style={{marginBottom:14,padding:"10px 14px",background:B.gray900,borderRadius:10,border:`1px solid ${B.gray700}`}}>
        <div style={{fontSize:10,color:B.gray400,fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>📅 Data/hora de entrada na oficina</div>
        {editEntry
          ?<div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
              <input value={entryInput} onChange={e=>setEntryInput(e.target.value)} type="datetime-local"
                style={{flex:"1 1 180px",padding:"7px 10px",borderRadius:7,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:13,outline:"none"}}/>
              <button onClick={saveEntry} style={{padding:"7px 14px",borderRadius:7,background:B.green,border:"none",color:B.white,fontWeight:700,fontSize:12,cursor:"pointer"}}>Salvar</button>
              {vehicle.enteredAt&&<button onClick={clearEntry} style={{padding:"7px 12px",borderRadius:7,background:"transparent",border:`1px solid ${B.red}44`,color:B.red,fontSize:12,cursor:"pointer"}}>Remover</button>}
              <button onClick={()=>setEditEntry(false)} style={{padding:"7px 10px",borderRadius:7,background:B.gray700,border:"none",color:B.gray200,fontSize:12,cursor:"pointer"}}>Cancelar</button>
            </div>
          :<div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:12.5,color:B.white,fontWeight:600}}>
                {new Date(vehicle.enteredAt).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"})}
              </span>
              {elapsed&&<span style={{fontSize:12,fontWeight:700,color:elapsed.color}}>— {elapsed.label} atrás</span>}
              <button onClick={()=>{setEntryInput(new Date(vehicle.enteredAt).toISOString().slice(0,16));setEditEntry(true);}} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:B.gray500,display:"flex",alignItems:"center",gap:3,fontSize:11}}>
                <IEdit s={11}/>Editar
              </button>
            </div>}
      </div>}

      {!vehicle.enteredAt&&!editEntry&&<button onClick={()=>setEditEntry(true)} style={{marginBottom:14,width:"100%",padding:"8px 0",borderRadius:8,background:"transparent",border:`1px dashed ${B.orange}66`,color:B.orange,cursor:"pointer",fontWeight:600,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
        <IClock s={13} c={B.orange}/>Registrar data/hora de entrada na oficina
      </button>}

      {/* Pending services */}
      {pending.length>0&&<>
        <div style={{fontSize:10,color:B.amber,fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>⏳ Serviços pendentes ({pending.length})</div>
        <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:12}}>
          {pending.map(t=>(
            <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",background:`${B.amber}11`,border:`1px solid ${B.amber}33`,borderRadius:7}}>
              <div style={{width:8,height:8,borderRadius:99,background:B.amber,flexShrink:0}}/>
              <span style={{fontSize:12.5,color:B.gray200,flex:1}}>{t.label}</span>
              {taskCost(t,defaultRate).total>0&&<span style={{fontSize:11,fontWeight:700,color:B.amber}}>{fmtBRL(taskCost(t,defaultRate).total)}</span>}
            </div>))}
        </div>
      </>}

      {/* Service history (completed tasks) */}
      {done.length>0&&<>
        <div style={{fontSize:10,color:B.green,fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>✅ Histórico de serviços concluídos ({done.length})</div>
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          {done.map(t=>{
            const tc=taskCost(t,defaultRate);
            return (<div key={t.id} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"7px 10px",background:B.greenBg,border:`1px solid ${B.green}33`,borderRadius:7}}>
              <ICheck s={13} c={B.green}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12.5,color:B.gray200,fontWeight:600}}>{t.label}</div>
                {(t.materials||[]).length>0&&<div style={{fontSize:11,color:B.gray400,marginTop:2}}>
                  {t.materials.map((m,i)=><span key={i} style={{marginRight:8}}>🔩 {m.name}{m.qty>1?` ×${m.qty}`:""}</span>)}
                </div>}
                {t.completedAt&&<div style={{fontSize:10,color:B.gray500,marginTop:2}}>
                  Concluído em {new Date(t.completedAt).toLocaleDateString("pt-BR")}
                </div>}
              </div>
              {tc.total>0&&<span style={{fontSize:11,fontWeight:700,color:B.green,flexShrink:0}}>{fmtBRL(tc.total)}</span>}
            </div>);
          })}
        </div>
        {doneCost>0&&<div style={{marginTop:8,padding:"7px 12px",background:B.amberBg,border:`1px solid ${B.amber}44`,borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:12,color:B.gray400}}>Total serviços concluídos</span>
          <span style={{fontSize:14,fontWeight:800,color:B.amber}}>{fmtBRL(doneCost)}</span>
        </div>}
      </>}

      {vts.length===0&&<div style={{textAlign:"center",padding:"16px 0",color:B.gray400,fontSize:13}}>Nenhum serviço registrado para este veículo ainda.</div>}
    </div>}
  </div>);
}

// ─── Settings Panel ───────────────────────────────────────────────────────────
// ─── Finance Tab ──────────────────────────────────────────────────────────────
function FinanceTab({tasks,vehicles,clients,employees,payments,defaultRate}) {
  const [from,setFrom]=useState("");
  const [to,setTo]=useState("");
  const sum=financeSummary(tasks,defaultRate,vehicles,clients,from,to);

  // Per-vehicle breakdown (only vehicles with at least 1 done task)
  const vehicleRows=vehicles.map(v=>{
    const vts=tasks.filter(t=>t.vehicleId===v.id&&t.done);
    if(vts.length===0)return null;
    const revenue=vts.reduce((s,t)=>s+taskCost(t,defaultRate).total,0);
    const cost=vts.reduce((s,t)=>s+taskCost(t,defaultRate).mat,0);
    const cli=clients.find(c=>c.id===v.clientId);
    const mech=employees.find(e=>e.id===v.employeeId);
    const total=vehicleTotal(v.id,tasks,defaultRate);
    const paid=vehiclePaid(v.id,payments);
    return {v,cli,mech,revenue,cost,profit:revenue-cost,total,paid,balance:total-paid};
  }).filter(Boolean);

  // Overall receivables
  const totalReceivable=vehicleRows.reduce((s,r)=>s+r.total,0);
  const totalPaidAll=vehicleRows.reduce((s,r)=>s+r.paid,0);
  const totalBalanceAll=totalReceivable-totalPaidAll;

  return (<div>
    {/* Date filter */}
    <div style={{display:"flex",gap:8,marginBottom:18,flexWrap:"wrap",alignItems:"center"}}>
      <span style={{fontSize:12,color:B.gray400}}>Período (tarefas concluídas):</span>
      <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={{padding:"6px 10px",borderRadius:7,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:12,outline:"none"}}/>
      <span style={{color:B.gray500,fontSize:12}}>até</span>
      <input type="date" value={to} onChange={e=>setTo(e.target.value)} style={{padding:"6px 10px",borderRadius:7,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:12,outline:"none"}}/>
      {(from||to)&&<button onClick={()=>{setFrom("");setTo("");}} style={{padding:"6px 10px",borderRadius:7,background:B.gray700,border:`1px solid ${B.gray600}`,color:B.gray200,cursor:"pointer",fontSize:12}}>Limpar</button>}
    </div>

    {/* Summary cards */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:24}}>
      {[
        {label:"Receita (tarefas concl.)",value:sum.revenue,color:B.blue,bg:B.blueBg,icon:<IChart s={16} c={B.blue}/>},
        {label:"Custo (material)",value:sum.cost,color:B.red,bg:`${B.red}18`,icon:<IBox s={16} c={B.red}/>},
        {label:"Lucro",value:sum.profit,color:B.green,bg:B.greenBg,icon:<ITrendUp s={16} c={B.green}/>},
        {label:"A receber (saldo aberto)",value:totalBalanceAll,color:B.amber,bg:B.amberBg,icon:<IBank s={16} c={B.amber}/>},
      ].map(c=>(<div key={c.label} style={{background:c.bg,border:`1px solid ${c.color}44`,borderRadius:12,padding:"14px 16px"}}>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>{c.icon}<span style={{fontSize:11,color:c.color,fontWeight:700}}>{c.label}</span></div>
        <div style={{fontSize:19,fontWeight:900,color:c.color}}>{fmtBRL(c.value)}</div>
      </div>))}
    </div>

    {/* Per-vehicle table */}
    <div style={{fontSize:11,color:B.gray400,fontWeight:700,marginBottom:10,textTransform:"uppercase",letterSpacing:.5}}>Detalhamento por veículo</div>
    {vehicleRows.length===0?<div style={{textAlign:"center",padding:"40px 0",color:B.gray400,fontSize:13}}>Nenhuma tarefa concluída ainda. O financeiro é alimentado conforme as OSs avançam.</div>
      :<div style={{display:"flex",flexDirection:"column",gap:8}}>
        {vehicleRows.map(r=>(<div key={r.v.id} style={{background:B.gray800,borderRadius:11,border:`1px solid ${B.gray700}`,padding:"12px 16px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <div style={{flex:"1 1 160px",minWidth:0}}>
            <div style={{fontWeight:700,fontSize:13.5,color:B.white,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.v.model} <span style={{color:B.gray400,fontFamily:"monospace",fontSize:11}}>{r.v.plate}</span></div>
            <div style={{fontSize:11,color:B.gray400,display:"flex",gap:8,flexWrap:"wrap"}}>
              {r.cli&&<span>👤 {r.cli.name}</span>}{r.mech&&<span>🔧 {r.mech.name}</span>}
            </div>
          </div>
          <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
            <div style={{textAlign:"right"}}><div style={{fontSize:10,color:B.gray400}}>Receita</div><div style={{fontSize:13,fontWeight:700,color:B.blue}}>{fmtBRL(r.revenue)}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:10,color:B.gray400}}>Custo</div><div style={{fontSize:13,fontWeight:700,color:B.red}}>{fmtBRL(r.cost)}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:10,color:B.gray400}}>Lucro</div><div style={{fontSize:13,fontWeight:800,color:B.green}}>{fmtBRL(r.profit)}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:10,color:B.gray400}}>Saldo</div><div style={{fontSize:13,fontWeight:800,color:r.balance>0?B.red:B.green}}>{r.balance>0?fmtBRL(r.balance):"Pago ✓"}</div></div>
          </div>
        </div>))}
      </div>}

    <ProductivityPanel employees={employees} vehicles={vehicles} tasks={tasks} defaultRate={defaultRate}/>
  </div>);
}

// ─── Monthly Productivity Panel ────────────────────────────────────────────────
function ProductivityPanel({employees,vehicles,tasks,defaultRate}) {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const [month,setMonth]=useState(defaultMonth);

  const rows = productivityByEmployee(employees, vehicles, tasks, defaultRate, month);
  const sorted = [...rows].sort((a,b)=>b.profit-a.profit);
  const capacityHours = rows[0]?.capacityHours || 0;

  return (<div style={{marginTop:28}}>
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap"}}>
      <div style={{fontSize:11,color:B.gray400,fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>📈 Produtividade Mensal por Funcionário</div>
      <input type="month" value={month} onChange={e=>setMonth(e.target.value)}
        style={{padding:"6px 10px",borderRadius:7,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:12,outline:"none"}}/>
      <span style={{fontSize:11,color:B.gray500}}>{monthLabel(month)} · capacidade: {capacityHours}h (dias úteis × 8h)</span>
    </div>

    {employees.length===0
      ?<div style={{textAlign:"center",padding:"30px 0",color:B.gray400,fontSize:13}}>Nenhum mecânico cadastrado.</div>
      :<div style={{display:"flex",flexDirection:"column",gap:8}}>
        {sorted.map(r=>{
          const occColor = r.occupancy>=80?B.green:r.occupancy>=40?B.amber:B.red;
          return (<div key={r.employee.id} style={{background:B.gray800,borderRadius:11,border:`1px solid ${B.gray700}`,padding:"12px 16px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
            <div style={{width:38,height:38,borderRadius:9,background:`${B.orange}22`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><IWrench s={18} c={B.orange}/></div>
            <div style={{flex:"1 1 140px",minWidth:0}}>
              <div style={{fontWeight:700,fontSize:13.5,color:B.white}}>{r.employee.name}</div>
              <div style={{fontSize:11,color:B.gray400}}>{r.taskCount} tarefa{r.taskCount!==1?"s":""} concluída{r.taskCount!==1?"s":""} no mês</div>
            </div>
            <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
              <div style={{textAlign:"right"}}><div style={{fontSize:10,color:B.gray400}}>Horas trabalhadas</div><div style={{fontSize:13,fontWeight:700,color:B.white}}>{r.hoursWorked.toFixed(1)}h</div></div>
              <div style={{textAlign:"right"}}><div style={{fontSize:10,color:B.gray400}}>Lucro gerado</div><div style={{fontSize:13,fontWeight:800,color:B.green}}>{fmtBRL(r.profit)}</div></div>
              <div style={{textAlign:"right"}}><div style={{fontSize:10,color:B.gray400}}>R$/hora produzido</div><div style={{fontSize:13,fontWeight:800,color:B.amber}}>{fmtBRL(r.ratePerHour)}</div></div>
              <div style={{textAlign:"right",minWidth:90}}>
                <div style={{fontSize:10,color:B.gray400}}>Ocupação do mês</div>
                <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"flex-end"}}>
                  <div style={{width:50,height:5,borderRadius:99,background:B.gray700,overflow:"hidden"}}>
                    <div style={{width:`${Math.min(100,r.occupancy)}%`,height:"100%",background:occColor,borderRadius:99}}/>
                  </div>
                  <span style={{fontSize:12,fontWeight:700,color:occColor}}>{r.occupancy.toFixed(0)}%</span>
                </div>
              </div>
            </div>
          </div>);
        })}
      </div>}
  </div>);
}

function SettingsPanel({defaultRate,onSaveRate,company,onSaveCompany,onClose}) {
  const [v,sV]=useState(String(defaultRate||0));
  const [comp,setComp]=useState({name:company?.name||"OSC Performance",address:company?.address||"",phone:company?.phone||"",document:company?.document||""});
  const save=()=>{
    onSaveRate(parseFloat(v.replace(",","."))||0);
    onSaveCompany(comp);
    onClose();
  };
  return (<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:80,padding:16}} onClick={onClose}>
    <div style={{background:B.gray800,borderRadius:16,maxWidth:420,width:"100%",overflow:"hidden",border:`1px solid ${B.gray700}`,maxHeight:"90vh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
      <div style={{padding:"14px 18px",background:B.gray900,borderBottom:`2px solid ${B.amber}`,display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
        <div style={{width:36,height:36,borderRadius:8,background:B.amberBg,display:"flex",alignItems:"center",justifyContent:"center"}}><IGear s={17} c={B.amber}/></div>
        <div><div style={{fontWeight:700,fontSize:14,color:B.white}}>Configurações</div><div style={{fontSize:12,color:B.gray400}}>Visível apenas ao gestor</div></div>
      </div>
      <div style={{padding:20,overflowY:"auto",flex:1}}>
        {/* Hourly rate */}
        <div style={{fontSize:11,color:B.amber,fontWeight:700,marginBottom:8,textTransform:"uppercase",letterSpacing:.5}}>Preço base por hora</div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{color:B.amber,fontWeight:700,fontSize:15}}>R$</span>
          <input value={v} onChange={e=>sV(e.target.value)} type="number" min="0" step="0.01"
            style={{flex:1,padding:"9px 12px",borderRadius:8,border:`1px solid ${B.amber}66`,background:B.gray900,color:B.white,fontSize:16,outline:"none",fontWeight:700}}/>
          <span style={{color:B.gray400,fontSize:13}}>/hora</span>
        </div>

        {/* Company info */}
        <div style={{fontSize:11,color:B.amber,fontWeight:700,marginTop:20,marginBottom:8,textTransform:"uppercase",letterSpacing:.5}}>Dados da empresa (aparecem no PDF de orçamento)</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <input value={comp.name} onChange={e=>setComp(p=>({...p,name:e.target.value}))} placeholder="Nome da empresa"
            style={{padding:"9px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none"}}/>
          <input value={comp.address} onChange={e=>setComp(p=>({...p,address:e.target.value}))} placeholder="Endereço completo"
            style={{padding:"9px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none"}}/>
          <div style={{display:"flex",gap:8}}>
            <input value={comp.phone} onChange={e=>setComp(p=>({...p,phone:e.target.value}))} placeholder="Telefone"
              style={{flex:1,padding:"9px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none"}}/>
            <input value={comp.document} onChange={e=>setComp(p=>({...p,document:e.target.value}))} placeholder="CNPJ"
              style={{flex:1,padding:"9px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none"}}/>
          </div>
        </div>

        <div style={{display:"flex",gap:8,marginTop:20}}>
          <button onClick={save} style={{flex:1,padding:"10px 0",borderRadius:9,background:B.amber,border:"none",color:B.black,fontWeight:800,cursor:"pointer",fontSize:14}}>Salvar</button>
          <button onClick={onClose} style={{padding:"10px 16px",borderRadius:9,background:B.gray700,border:`1px solid ${B.gray600}`,color:B.gray200,cursor:"pointer",fontWeight:600,fontSize:13}}>Cancelar</button>
        </div>
      </div>
    </div>
  </div>);
}

// ─── Public Vehicle View ──────────────────────────────────────────────────────
function PublicVehicleView({vehicleId,vehicles,tasks,employees,clients}) {
  const v=vehicles.find(x=>x.id===vehicleId);
  if(!v) return (<div style={{minHeight:"100vh",background:B.black,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter','Segoe UI',sans-serif"}}>
    <div style={{textAlign:"center",color:B.gray400}}><div style={{fontSize:48,marginBottom:12}}>🔍</div><div style={{fontSize:16,color:B.gray200,fontWeight:700}}>Veículo não encontrado</div></div>
  </div>);
  const ts=tasks.filter(t=>t.vehicleId===v.id),done=ts.filter(t=>t.done).length;
  const mech=employees.find(e=>e.id===v.employeeId),cli=clients.find(c=>c.id===v.clientId);
  const pct=ts.length?Math.round(done/ts.length*100):0;
  const photos=v.photos||[];
  const [lb,setLB]=useState(null);
  return (<div style={{minHeight:"100vh",background:B.black,fontFamily:"'Inter','Segoe UI',sans-serif",color:B.white}}>
    {/* Header */}
    <div style={{background:B.gray900,borderBottom:`1px solid ${B.gray700}`,padding:"14px 20px",display:"flex",alignItems:"center",gap:12}}>
      <div style={{width:36,height:36,borderRadius:8,background:B.orange,display:"flex",alignItems:"center",justifyContent:"center"}}><IWrench s={18} c={B.white}/></div>
      <div><div style={{fontWeight:900,fontSize:15,color:B.white}}>OSC <span style={{color:B.orange}}>Performance</span></div><div style={{fontSize:10,color:B.gray400,textTransform:"uppercase",letterSpacing:.5}}>Acompanhamento de serviço</div></div>
    </div>
    <div style={{maxWidth:600,margin:"0 auto",padding:"24px 16px"}}>
      {/* Car identity card */}
      <div style={{background:B.gray800,borderRadius:16,overflow:"hidden",marginBottom:20,border:`1px solid ${B.gray700}`}}>
        {v.photo&&<img src={v.photo} alt="" style={{width:"100%",height:200,objectFit:"cover"}}/>}
        <div style={{padding:"16px 20px"}}>
          <div style={{fontWeight:900,fontSize:20,color:B.white}}>{v.model}</div>
          <div style={{fontSize:13,color:B.gray400,fontFamily:"monospace",letterSpacing:1,marginBottom:8}}>{v.plate}</div>
          {cli&&<div style={{fontSize:13,color:B.gray200}}>👤 {cli.name}</div>}
          {mech&&<div style={{fontSize:13,color:B.gray200}}>🔧 Mecânico: {mech.name}</div>}
        </div>
      </div>
      {/* Progress */}
      <div style={{background:B.gray800,borderRadius:14,padding:"16px 20px",marginBottom:20,border:`1px solid ${B.gray700}`}}>
        <div style={{fontWeight:700,fontSize:13,color:B.white,marginBottom:10}}>📋 Progresso do serviço</div>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
          <div style={{flex:1,height:10,borderRadius:99,background:B.gray700,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:pct===100?B.green:B.orange,borderRadius:99,transition:"width .5s"}}/></div>
          <span style={{fontSize:16,fontWeight:900,color:pct===100?B.green:B.orange,minWidth:44}}>{pct}%</span>
        </div>
        {pct===100&&<div style={{background:B.greenBg,border:`1px solid ${B.green}55`,borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13,fontWeight:700,color:B.green,textAlign:"center"}}>🎉 Seu veículo está pronto para retirada!</div>}
        {ts.map(t=><div key={t.id} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"7px 0",borderBottom:`1px solid ${B.gray700}`}}>
          <span style={{fontSize:16,flexShrink:0}}>{t.done?"✅":"⬜"}</span>
          <div>
            <div style={{fontSize:13.5,color:t.done?B.gray400:B.gray200,textDecoration:t.done?"line-through":"none"}}>{t.label}</div>
            {(t.materials||[]).map((m,i)=><div key={i} style={{fontSize:11,color:B.gray400,marginTop:2}}>🔩 {m.name}</div>)}
          </div>
        </div>)}
      </div>
      {/* Photos */}
      {photos.length>0&&<div style={{background:B.gray800,borderRadius:14,padding:"16px 20px",border:`1px solid ${B.gray700}`}}>
        <div style={{fontWeight:700,fontSize:13,color:B.white,marginBottom:10}}>📷 Fotos do serviço</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {photos.map((src,i)=><div key={i} style={{width:120,height:120,borderRadius:8,overflow:"hidden",cursor:"pointer",border:`1px solid ${B.gray600}`}} onClick={()=>setLB(src)}>
            <img src={src} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
          </div>)}
        </div>
      </div>}
      <div style={{marginTop:20,textAlign:"center",fontSize:12,color:B.gray500}}>
        Atualizado em {fmtD()} · OSC Performance
      </div>
    </div>
    {lb&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.95)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setLB(null)}>
      <img src={lb} alt="" style={{maxWidth:"95vw",maxHeight:"95vh",objectFit:"contain",borderRadius:8}}/>
    </div>}
  </div>);
}

// ─── App ─────────────────────────────────────────────────────────────────────
// ─── Loading / Error screens ──────────────────────────────────────────────────
function LoadingScreen() {
  return (<div style={{minHeight:"100vh",background:B.black,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter','Segoe UI',sans-serif"}}>
    <div style={{textAlign:"center"}}>
      <div style={{width:48,height:48,borderRadius:12,background:B.orange,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",animation:"pulse 1.4s infinite"}}>
        <IWrench s={24} c={B.white}/>
      </div>
      <div style={{color:B.gray400,fontSize:13}}>Carregando OSC Performance…</div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  </div>);
}
function ErrorScreen({msg}) {
  return (<div style={{minHeight:"100vh",background:B.black,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter','Segoe UI',sans-serif",padding:20}}>
    <div style={{textAlign:"center",maxWidth:400}}>
      <div style={{fontSize:40,marginBottom:14}}>⚠️</div>
      <div style={{color:B.white,fontWeight:700,fontSize:16,marginBottom:8}}>Erro ao conectar</div>
      <div style={{color:B.gray400,fontSize:13}}>{msg}</div>
    </div>
  </div>);
}

// ─── Mechanic Login Screen ─────────────────────────────────────────────────────
function MechanicLoginScreen({employees,onLogin}) {
  const [phone,setPhone]=useState("");
  const [err,setErr]=useState("");
  const tryLogin=()=>{
    const found=employees.find(e=>samePhone(e.phone,phone));
    if(!found){ setErr("Número não encontrado. Confira com o gestor da oficina."); return; }
    onLogin(found);
  };
  return (<div style={{minHeight:"100vh",background:B.black,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter','Segoe UI',sans-serif",padding:20}}>
    <div style={{maxWidth:380,width:"100%"}}>
      <div style={{textAlign:"center",marginBottom:28}}>
        <div style={{width:56,height:56,borderRadius:14,background:B.orange,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px"}}><IWrench s={28} c={B.white}/></div>
        <div style={{fontWeight:900,fontSize:20,color:B.white}}>OSC <span style={{color:B.orange}}>Performance</span></div>
        <div style={{fontSize:12,color:B.gray400,marginTop:4}}>Acesso do Mecânico</div>
      </div>
      <div style={{background:B.gray800,borderRadius:16,padding:24,border:`1px solid ${B.gray700}`}}>
        <label style={{display:"flex",alignItems:"center",gap:6,fontSize:13,color:B.gray200,fontWeight:600,marginBottom:10}}><ILock s={14} c={B.orange}/>Seu número de WhatsApp</label>
        <input value={phone} onChange={e=>{setPhone(e.target.value);setErr("");}} onKeyDown={e=>e.key==="Enter"&&tryLogin()}
          placeholder="Ex: 5511999998888" autoFocus
          style={{width:"100%",padding:"12px 14px",borderRadius:10,border:`1px solid ${err?B.red:B.gray600}`,background:B.gray900,color:B.white,fontSize:15,outline:"none",boxSizing:"border-box"}}/>
        {err&&<div style={{color:B.red,fontSize:12,marginTop:8}}>{err}</div>}
        <button onClick={tryLogin} style={{width:"100%",marginTop:16,padding:"12px 0",borderRadius:10,background:B.orange,border:"none",color:B.white,fontWeight:800,fontSize:14,cursor:"pointer"}}>Entrar</button>
        <div style={{marginTop:14,fontSize:11.5,color:B.gray500,textAlign:"center",lineHeight:1.5}}>Use o mesmo número cadastrado pelo gestor da oficina, com DDI e DDD (ex: 55119...)</div>
      </div>
    </div>
  </div>);
}

// ─── Mechanic Portal (filtered view for logged-in mechanic) ──────────────────
function MechanicPortal({employee,vehicles,tasks,employees,clients,stock,onAddTask,onToggleTask,onDeleteTask,onUpdateTask,onLogout}) {
  const empV=[...vehicles.filter(v=>(v.mechanicIds||[v.employeeId]).includes(employee.id) && v.status!=="ready")]
    .sort((a,b)=>(a.status==="paused"?1:0)-(b.status==="paused"?1:0));
  const totT=tasks.filter(t=>empV.find(v=>v.id===t.vehicleId)).length;
  const donT=tasks.filter(t=>empV.find(v=>v.id===t.vehicleId)&&t.done).length;
  return (<div style={{minHeight:"100vh",background:B.black,fontFamily:"'Inter','Segoe UI',sans-serif",color:B.white}}>
    <div style={{background:B.gray900,borderBottom:`1px solid ${B.gray700}`,padding:"0 18px",position:"sticky",top:0,zIndex:20}}>
      <div style={{maxWidth:680,margin:"0 auto",display:"flex",alignItems:"center",height:58,gap:12}}>
        <div style={{width:36,height:36,borderRadius:9,background:B.orange,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><IWrench s={18} c={B.white}/></div>
        <div><div style={{fontWeight:800,fontSize:14,color:B.white}}>{employee.name}</div><div style={{fontSize:10,color:B.gray400,textTransform:"uppercase",letterSpacing:.5}}>Minhas Tarefas — OSC Performance</div></div>
        <button onClick={onLogout} style={{marginLeft:"auto",padding:"7px 12px",borderRadius:8,background:B.gray800,border:`1px solid ${B.gray700}`,color:B.gray300,cursor:"pointer",fontWeight:600,fontSize:12,display:"flex",alignItems:"center",gap:5}}>
          <ILogout s={13} c={B.gray300}/>Sair
        </button>
      </div>
    </div>
    <div style={{maxWidth:680,margin:"0 auto",padding:"20px 14px"}}>
      <div style={{background:B.gray800,borderRadius:12,padding:"14px 18px",marginBottom:18,border:`1px solid ${B.gray700}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontSize:12,color:B.gray400}}>Resumo do dia</div><div style={{fontWeight:700,fontSize:14,color:B.white}}>{empV.length} veículo{empV.length!==1?"s":""} · {donT}/{totT} tarefas</div></div>
        {totT>0&&<ProgressBar value={donT} max={totT}/>}
      </div>
      {empV.length===0?<div style={{textAlign:"center",padding:"56px 0",color:B.gray400}}><div style={{fontSize:44,marginBottom:12}}>🔧</div><div style={{fontWeight:700,fontSize:15,color:B.gray200}}>Nenhum veículo atribuído a você ainda</div></div>
        :empV.map(v=><VehicleCard key={v.id} vehicle={v} tasks={tasks} employees={employees} clients={clients} stock={stock} defaultRate={0} managerMode={false}
          onAddTask={onAddTask} onToggleTask={onToggleTask} onDeleteTask={onDeleteTask} onUpdateTask={onUpdateTask}
          onDeleteVehicle={()=>{}} onTransferMechanic={()=>{}} onTransferOwner={()=>{}} onUpdateVehicle={()=>{}}
          onConsumeStock={()=>{}} onReturnStock={()=>{}} hideManagerButtons/>)}
    </div>
  </div>);
}

// ─── Admin Login Screen ─────────────────────────────────────────────────────
const ADMIN_SESSION_KEY = "osc_admin_session";

// Each role has its own password (set as Vercel env vars) and its own access level.
// owner: sees everything. admin: everything except Financeiro. supervisor: only Mecânicos + Estoque.
const ROLE_CONFIG = {
  owner:      { label:"Gestor",            tabs:["mechanics","clients","stock","vehicles","clientsMonitor","finance"], envVar:"VITE_OWNER_PASSWORD" },
  admin:      { label:"Administrativo",    tabs:["mechanics","clients","stock","vehicles","clientsMonitor"],           envVar:"VITE_ADMIN_PASSWORD" },
  supervisor: { label:"Chefe de Oficina",  tabs:["mechanics","stock"],                                                  envVar:"VITE_SUPERVISOR_PASSWORD" },
};
function getRolePassword(role) {
  const envVar = ROLE_CONFIG[role]?.envVar;
  return (envVar && import.meta.env[envVar]) || "";
}
// Tries the entered password against all configured roles, returns the matching role or null.
function matchRole(pwd) {
  for (const role of Object.keys(ROLE_CONFIG)) {
    const real = getRolePassword(role);
    if (real && pwd === real) return role;
  }
  return null;
}
function AdminLoginScreen({onLogin}) {
  const [pwd,setPwd]=useState("");
  const [err,setErr]=useState("");
  const tryLogin=()=>{
    const anyConfigured = Object.keys(ROLE_CONFIG).some(r=>getRolePassword(r));
    if(!anyConfigured){ setErr("Nenhuma senha configurada. Configure as variáveis de ambiente no Vercel."); return; }
    const role = matchRole(pwd);
    if(!role){ setErr("Senha incorreta."); return; }
    onLogin(role);
  };
  return (<div style={{minHeight:"100vh",background:B.black,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter','Segoe UI',sans-serif",padding:20}}>
    <div style={{maxWidth:380,width:"100%"}}>
      <div style={{textAlign:"center",marginBottom:28}}>
        <div style={{width:56,height:56,borderRadius:14,background:B.orange,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px"}}><IWrench s={28} c={B.white}/></div>
        <div style={{fontWeight:900,fontSize:20,color:B.white}}>OSC <span style={{color:B.orange}}>Performance</span></div>
        <div style={{fontSize:12,color:B.gray400,marginTop:4}}>Acesso administrativo</div>
      </div>
      <div style={{background:B.gray800,borderRadius:16,padding:24,border:`1px solid ${B.gray700}`}}>
        <label style={{display:"flex",alignItems:"center",gap:6,fontSize:13,color:B.gray200,fontWeight:600,marginBottom:10}}><ILock s={14} c={B.orange}/>Senha de acesso</label>
        <input value={pwd} onChange={e=>{setPwd(e.target.value);setErr("");}} onKeyDown={e=>e.key==="Enter"&&tryLogin()}
          type="password" placeholder="••••••••" autoFocus
          style={{width:"100%",padding:"12px 14px",borderRadius:10,border:`1px solid ${err?B.red:B.gray600}`,background:B.gray900,color:B.white,fontSize:15,outline:"none",boxSizing:"border-box"}}/>
        {err&&<div style={{color:B.red,fontSize:12,marginTop:8}}>{err}</div>}
        <button onClick={tryLogin} style={{width:"100%",marginTop:16,padding:"12px 0",borderRadius:10,background:B.orange,border:"none",color:B.white,fontWeight:800,fontSize:14,cursor:"pointer"}}>Entrar</button>
        <div style={{marginTop:14,fontSize:11.5,color:B.gray500,textAlign:"center",lineHeight:1.5}}>O nível de acesso é definido automaticamente pela senha usada.</div>
      </div>
    </div>
  </div>);
}

export default function App() {
  // Check for public vehicle link
  const params=new URLSearchParams(window.location.search);
  const publicVehicleId=params.get("v");
  const isMechanicPortal=params.get("portal")==="mecanico";

  const [employees,setEmp]=useState([]);
  const [clients,  setCli]=useState([]);
  const [vehicles, setVeh]=useState([]);
  const [tasks,    setTsk]=useState([]);
  const [stock,    setStk]=useState([]);
  const [payments, setPay]=useState([]);
  const [stockPurchases, setStockPurchases]=useState([]);
  const [vehicleOwners, setVehicleOwners]=useState([]);
  const [defaultRate,setDR]=useState(0);
  const [company,setCompany]=useState({name:"OSC Performance",address:"",phone:"",document:""});
  const [tab,      setTab]=useState("mechanics");
  const [modal,    setMod]=useState(null);
  const [toast,    setTst]=useState(null);
  const [showCfg,  setSCfg]=useState(false);
  const [loading,  setLoading]=useState(true);
  const [loadError,setLE]=useState(null);
  const [mechSession,setMechSession]=useState(()=>{
    try{ return JSON.parse(localStorage.getItem(LOGIN_KEY)||"null"); }catch{ return null; }
  });
  const [adminRole,setAdminRole]=useState(()=>{
    try{ return sessionStorage.getItem(ADMIN_SESSION_KEY)||null; }catch{ return null; }
  });

  const [eN,setEN]=useState(""); const [eP,setEP]=useState("");
  const [cN,setCN]=useState(""); const [cP,setCP]=useState(""); const [cE,setCE]=useState("");

  const toast_=useCallback(m=>{setTst(null);setTimeout(()=>setTst(m),10);},[]);
  const errToast=useCallback(e=>{console.error(e);toast_("⚠ Erro: "+(e.message||"falha de conexão"));},[toast_]);

  // ── Initial load from Supabase ──
  useEffect(()=>{
    db.loadAll().then(d=>{
      setEmp(d.employees); setCli(d.clients); setVeh(d.vehicles);
      setTsk(d.tasks); setStk(d.stock); setDR(d.defaultRate); setPay(d.payments||[]);
      if(d.company) setCompany(d.company);
      setStockPurchases(d.stockPurchases||[]);
      setVehicleOwners(d.vehicleOwners||[]);
      setLoading(false);
    }).catch(e=>{ setLE(e.message); setLoading(false); });
  },[]);

  // If public view (still needs data loaded)
  if(publicVehicleId){
    if(loading) return <LoadingScreen/>;
    return <PublicVehicleView vehicleId={publicVehicleId} vehicles={vehicles} tasks={tasks} employees={employees} clients={clients}/>;
  }
  if(loading) return <LoadingScreen/>;
  if(loadError) return <ErrorScreen msg={loadError}/>;

  // ── Mechanic portal mode (?portal=mecanico) ──
  if(isMechanicPortal){
    const doLogin=(emp)=>{ setMechSession(emp); localStorage.setItem(LOGIN_KEY,JSON.stringify(emp)); };
    const doLogout=()=>{ setMechSession(null); localStorage.removeItem(LOGIN_KEY); };
    const liveEmp=mechSession?(employees.find(e=>e.id===mechSession.id)||mechSession):null;
    if(!liveEmp) return <MechanicLoginScreen employees={employees} onLogin={doLogin}/>;
    return <MechanicPortal employee={liveEmp} vehicles={vehicles} tasks={tasks} employees={employees} clients={clients} stock={stock}
      onAddTask={async(vid,lbl)=>{try{const row=await db.addTask({vehicleId:vid,label:lbl,done:false,materials:[],hours:0,ratePerHour:null,completedAt:null});setTsk(p=>[...p,row]);}catch(e){errToast(e);}}}
      onToggleTask={async id=>{ const t=tasks.find(x=>x.id===id); const nowDone=!t.done; const completedAt=nowDone?new Date().toISOString():null; const completedByEmployeeId=nowDone?liveEmp.id:null; setTsk(p=>p.map(t=>t.id===id?{...t,done:nowDone,completedAt,completedByEmployeeId}:t)); try{await db.updateTask(id,{done:nowDone,completedAt,completedByEmployeeId});}catch(e){errToast(e);} }}
      onDeleteTask={async id=>{setTsk(p=>p.filter(t=>t.id!==id));try{await db.deleteTask(id);}catch(e){errToast(e);}}}
      onUpdateTask={async(id,patch)=>{setTsk(p=>p.map(t=>t.id===id?{...t,...patch}:t));try{await db.updateTask(id,patch);}catch(e){errToast(e);}}}
      onLogout={doLogout}/>;
  }

  // ── Admin gate: everything below requires the admin password ──
  if(!adminRole){
    return <AdminLoginScreen onLogin={(role)=>{ setAdminRole(role); try{ sessionStorage.setItem(ADMIN_SESSION_KEY,role); }catch{} }}/>;
  }
  const allowedTabs = ROLE_CONFIG[adminRole]?.tabs || ["mechanics"];
  if(!allowedTabs.includes(tab) && allowedTabs.length){
    // Defer to avoid setState-during-render warning; falls back to first allowed tab next render
    setTimeout(()=>setTab(allowedTabs[0]),0);
  }


  // ── Employees
  const addEmp=async()=>{
    if(!eN.trim())return;
    try{ const row=await db.addEmployee(eN.trim(),eP.trim()); setEmp(p=>[...p,row]); setEN("");setEP("");toast_("Mecânico cadastrado ✓"); }
    catch(e){errToast(e);}
  };
  const delEmp=async id=>{
    const vs=vehicles.filter(v=>v.employeeId===id).map(v=>v.id);
    setTsk(p=>p.filter(t=>!vs.includes(t.vehicleId)));
    setVeh(p=>p.filter(v=>v.employeeId!==id));
    setEmp(p=>p.filter(e=>e.id!==id));
    try{ await db.deleteEmployee(id); }catch(e){errToast(e);}
  };
  const updEmpP=async(id,ph)=>{
    setEmp(p=>p.map(e=>e.id===id?{...e,phone:ph}:e));
    try{ await db.updateEmployee(id,{phone:ph}); toast_("WA salvo ✓"); }catch(e){errToast(e);}
  };
  const updEmpN=async(id,n)=>{
    setEmp(p=>p.map(e=>e.id===id?{...e,name:n}:e));
    try{ await db.updateEmployee(id,{name:n}); }catch(e){errToast(e);}
  };

  // ── Clients
  const addCli=async()=>{
    if(!cN.trim())return;
    try{ const row=await db.addClient(cN.trim(),cP.trim(),cE.trim()); setCli(p=>[...p,row]); setCN("");setCP("");setCE("");toast_("Cliente cadastrado ✓"); }
    catch(e){errToast(e);}
  };
  const delCli=async id=>{
    setVeh(p=>p.map(v=>v.clientId===id?{...v,clientId:null}:v));
    setCli(p=>p.filter(c=>c.id!==id));
    try{ await db.deleteClient(id); }catch(e){errToast(e);}
  };
  const updCliP=async(id,ph)=>{
    setCli(p=>p.map(c=>c.id===id?{...c,phone:ph}:c));
    try{ await db.updateClient(id,{phone:ph}); toast_("WA salvo ✓"); }catch(e){errToast(e);}
  };
  const updCliN=async(id,n)=>{
    setCli(p=>p.map(c=>c.id===id?{...c,name:n}:c));
    try{ await db.updateClient(id,{name:n}); }catch(e){errToast(e);}
  };
  const updCliE=async(id,email)=>{
    setCli(p=>p.map(c=>c.id===id?{...c,email}:c));
    try{ await db.updateClient(id,{email}); toast_("E-mail salvo ✓"); }catch(e){errToast(e);}
  };

  // ── Vehicles
  const addVeh=async(eid,model,plate)=>{
    try{
      const row=await db.addVehicle({employeeId:eid,clientId:null,model,plate,photo:null,photos:[]});
      setVeh(p=>[...p,row]); toast_("Veículo adicionado ✓");
    }catch(e){errToast(e);}
  };
  const delVeh=async id=>{
    setTsk(p=>p.filter(t=>t.vehicleId!==id));
    setVeh(p=>p.filter(v=>v.id!==id));
    try{ await db.deleteVehicle(id); }catch(e){errToast(e);}
  };
  const updVeh=async(id,patch)=>{
    setVeh(p=>p.map(v=>v.id===id?{...v,...patch}:v));
    try{ await db.updateVehicle(id,patch); }catch(e){errToast(e);}
  };
  // Add a mechanic to a vehicle (multi-mechanic)
  const addVehicleMechanic=async(vid,eid)=>{
    if(!eid)return;
    setVeh(p=>p.map(v=>v.id===vid?{...v,mechanicIds:[...new Set([...(v.mechanicIds||[]),eid])]}:v));
    try{ await db.addVehicleMechanic(vid,eid); toast_(`${employees.find(e=>e.id===eid)?.name} adicionado ao veículo ✓`); }catch(e){errToast(e);}
  };
  const removeVehicleMechanic=async(vid,eid)=>{
    setVeh(p=>p.map(v=>v.id===vid?{...v,mechanicIds:(v.mechanicIds||[]).filter(id=>id!==eid)}:v));
    try{ await db.removeVehicleMechanic(vid,eid); toast_("Mecânico removido do veículo ✓"); }catch(e){errToast(e);}
  };
  // Legacy single-transfer kept for TransferModal compat (adds mechanic instead of replacing)
  const xferMech=async(vid,eid)=>{ addVehicleMechanic(vid,eid); };

  // Transfer vehicle owner (with history)
  const xferOwn=async(vid,cid)=>{
    const now = new Date().toISOString();
    // Close old owner record in local state
    setVehicleOwners(p=>p.map(o=>o.vehicle_id===vid&&o.is_current?{...o,ended_at:now,is_current:false}:o));
    // Add new owner record in local state
    const newOwnerRecord = {id:`temp-${Date.now()}`,vehicle_id:vid,client_id:cid,started_at:now,ended_at:null,is_current:true};
    setVehicleOwners(p=>[...p,newOwnerRecord]);
    setVeh(p=>p.map(v=>v.id===vid?{...v,clientId:cid,currentClientId:cid}:v));
    try{ await db.transferVehicleOwner(vid,cid); toast_(`Transferido para ${clients.find(c=>c.id===cid)?.name} ✓`); }catch(e){errToast(e);}
  };

  // Vehicle status (Ativo/Pausado/Pronto) — owner-only
  const setVehicleStatus=async(vid,newStatus)=>{
    const v=vehicles.find(x=>x.id===vid);
    if(!v)return;
    const now=Date.now();
    let patch={status:newStatus};
    if(newStatus==="paused"){
      // Starting a pause — record when
      patch.pausedAt=new Date().toISOString();
    } else if(v.status==="paused"&&v.pausedAt){
      // Ending a pause — accumulate elapsed
      const added=now-new Date(v.pausedAt).getTime();
      patch.totalPausedMs=(v.totalPausedMs||0)+added;
      patch.pausedAt=null;
    } else {
      patch.pausedAt=null;
    }
    setVeh(p=>p.map(x=>x.id===vid?{...x,...patch}:x));
    try{ await db.updateVehicle(vid,patch); }catch(e){errToast(e);}
  };

  // ── Tasks
  const addTask=async(vid,lbl)=>{
    try{
      const row=await db.addTask({vehicleId:vid,label:lbl,done:false,materials:[],hours:0,ratePerHour:null,completedAt:null});
      setTsk(p=>[...p,row]);
    }catch(e){errToast(e);}
  };
  const toggleT=async(id, signerEmployeeId)=>{
    const t=tasks.find(x=>x.id===id);
    const nowDone=!t.done;
    const completedAt = nowDone ? new Date().toISOString() : null;
    const completedByEmployeeId = nowDone ? (signerEmployeeId||null) : null;
    setTsk(p=>p.map(t=>t.id===id?{...t,done:nowDone,completedAt,completedByEmployeeId}:t));
    try{ await db.updateTask(id,{done:nowDone,completedAt,completedByEmployeeId}); }catch(e){errToast(e);}
  };
  const delTask=async id=>{
    const t=tasks.find(x=>x.id===id);
    // return any stock-linked materials before deleting the task
    const stockMats=(t?.materials||[]).filter(m=>m.fromStock&&m.stockItemId);
    for(const m of stockMats){
      const item=stock.find(s=>s.id===m.stockItemId);
      if(item){
        setStk(p=>p.map(s=>s.id===m.stockItemId?{...s,qty:s.qty+1}:s));
        try{ await db.updateStock(m.stockItemId,{qty:item.qty+1}); }catch(e){errToast(e);}
      }
    }
    setTsk(p=>p.filter(t=>t.id!==id));
    try{ await db.deleteTask(id); }catch(e){errToast(e);}
  };
  const updTask=async(id,patch)=>{
    setTsk(p=>p.map(t=>t.id===id?{...t,...patch}:t));
    try{ await db.updateTask(id,patch); }catch(e){errToast(e);}
  };
  // Adds a stock item as a new material entry (list grows, no limit)
  const consumeStock=async(taskId,item,currentMats)=>{
    const newQty=Math.max(0,item.qty-1);
    const mats = currentMats || tasks.find(t=>t.id===taskId)?.materials || [];
    const newMats = [...mats,{name:item.name,cost:item.salePrice,qty:1,fromStock:true,stockItemId:item.id}];
    setStk(p=>p.map(s=>s.id===item.id?{...s,qty:newQty}:s));
    setTsk(p=>p.map(t=>t.id===taskId?{...t,materials:newMats}:t));
    try{
      await db.updateStock(item.id,{qty:newQty});
      await db.updateTask(taskId,{materials:newMats});
      toast_(`${item.name} descontado do estoque ✓`);
    }catch(e){errToast(e);}
  };
  // Removes one specific material (by index) from a task's list and returns its full quantity to stock if applicable
  const returnStock=async(taskId,matIdx,stockItemId)=>{
    const t=tasks.find(x=>x.id===taskId);
    const removedMat = t?.materials?.[matIdx];
    if(stockItemId){
      const item=stock.find(s=>s.id===stockItemId);
      const returnQty = Number(removedMat?.qty||1);
      const newQty=(item?.qty||0)+returnQty;
      setStk(p=>p.map(s=>s.id===stockItemId?{...s,qty:newQty}:s));
      try{ await db.updateStock(stockItemId,{qty:newQty}); }catch(e){errToast(e);}
    }
    const newMats=(t?.materials||[]).filter((_,i)=>i!==matIdx);
    setTsk(p=>p.map(t=>t.id===taskId?{...t,materials:newMats}:t));
    try{ await db.updateTask(taskId,{materials:newMats}); toast_("Item devolvido ao estoque ✓"); }catch(e){errToast(e);}
  };

  // ── Stock
  const addStock=async(item)=>{
    try{ const row=await db.addStock(item); setStk(p=>[...p,row]); toast_("Produto adicionado ✓"); }
    catch(e){errToast(e);}
  };
  const updStock=async(id,patch)=>{
    setStk(p=>p.map(s=>{
      if(s.id!==id)return s;
      const n={...s,...patch};
      n.salePrice=Number(n.costPrice||0)*(1+Number(n.markup||0)/100);
      return n;
    }));
    try{
      const current=stock.find(s=>s.id===id);
      const merged={...current,...patch};
      const salePrice=Number(merged.costPrice||0)*(1+Number(merged.markup||0)/100);
      await db.updateStock(id,{...patch,salePrice});
    }catch(e){errToast(e);}
  };
  const delStock=async id=>{
    setStk(p=>p.filter(s=>s.id!==id));
    try{ await db.deleteStock(id); toast_("Produto removido ✓"); }catch(e){errToast(e);}
  };
  const addPurchase=async(purchase)=>{
    try{
      const row=await db.addPurchase(purchase);
      setStockPurchases(p=>[row,...p]);
      const item=stock.find(s=>s.id===purchase.stockId);
      if(item){
        const newQty=item.qty+purchase.qty;
        setStk(p=>p.map(s=>s.id===purchase.stockId?{...s,qty:newQty}:s));
        await db.updateStock(purchase.stockId,{qty:newQty});
      }
      toast_(`Compra registrada: +${purchase.qty} ${item?.name||""} ✓`);
    }catch(e){errToast(e);}
  };
  const updatePurchase=async(id,patch)=>{
    setStockPurchases(p=>p.map(x=>x.id===id?{...x,...patch}:x));
    try{ await db.updatePurchase(id,patch); toast_("Compra atualizada ✓"); }catch(e){errToast(e);}
  };
  const deletePurchase=async(id)=>{
    setStockPurchases(p=>p.filter(x=>x.id!==id));
    try{ await db.deletePurchase(id); toast_("Compra excluída ✓"); }catch(e){errToast(e);}
  };

  // ── Settings
  const saveRate=async r=>{
    setDR(r);
    try{ await db.setDefaultRate(r); toast_(`R$/h atualizado: ${fmtBRL(r)} ✓`); }catch(e){errToast(e);}
  };
  const saveCompany=async info=>{
    setCompany(info);
    try{ await db.setCompanyInfo(info); toast_("Dados da empresa salvos ✓"); }catch(e){errToast(e);}
  };

  // ── WA
  // ── Payments (conta corrente) ──
  const addPayment=async(p)=>{
    try{ const row=await db.addPayment(p); setPay(prev=>[...prev,row]); toast_(`Pagamento de ${fmtBRL(p.amount)} registrado ✓`); }
    catch(e){errToast(e);}
  };
  const deletePayment=async(id)=>{
    setPay(prev=>prev.filter(p=>p.id!==id));
    try{ await db.deletePayment(id); toast_("Pagamento removido ✓"); }catch(e){errToast(e);}
  };

  // ── WA
  const sendMechWA=emp=>setMod({title:`Enviar para ${emp.name}`,subtitle:"Mecânico",accentColor:B.orange,phone:emp.phone,text:waMechanic(emp,vehicles,tasks,clients)});
  const sendCliWA =cli=>setMod({title:`Enviar para ${cli.name}`,subtitle:"Cliente — com valores",accentColor:B.wa,phone:cli.phone,text:waClient(cli,vehicles,tasks,employees,defaultRate)});


  const doneT=tasks.filter(t=>t.done).length;
  const tabBtn=(key,lbl,ico,ac)=>(<button onClick={()=>setTab(key)} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 16px",borderRadius:8,border:"none",cursor:"pointer",fontWeight:700,fontSize:13,transition:"all .2s",background:tab===key?ac:"transparent",color:tab===key?B.white:B.gray400}}>{ico}{lbl}</button>);
  const IGear2=()=><Svg d="M12 15a3 3 0 100-6 3 3 0 000 6z" d2="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" s={17} c={B.amber}/>;

  return (<div style={{minHeight:"100vh",background:B.black,fontFamily:"'Inter','Segoe UI',sans-serif",color:B.white}}>
    {/* Topbar */}
    <div style={{background:B.gray900,borderBottom:`1px solid ${B.gray700}`,padding:"0 20px",position:"sticky",top:0,zIndex:20,boxShadow:"0 2px 20px rgba(0,0,0,.6)"}}>
      <div style={{maxWidth:820,margin:"0 auto",display:"flex",alignItems:"center",height:60,gap:12}}>
        <div style={{width:38,height:38,borderRadius:9,background:B.orange,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><IWrench s={20} c={B.white}/></div>
        <div><div style={{fontWeight:900,fontSize:15,color:B.white,letterSpacing:"-.5px"}}>OSC <span style={{color:B.orange}}>Performance</span></div><div style={{fontSize:9,color:B.gray400,textTransform:"uppercase",letterSpacing:.6}}>{ROLE_CONFIG[adminRole]?.label||"Gestão de Oficina"}</div></div>
        <div style={{marginLeft:"auto",display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}}>
          {[{l:"Mec.",v:employees.length,c:B.orange},{l:"Clientes",v:clients.length,c:B.blue},{l:"Veículos",v:vehicles.length,c:B.gray200},{l:"Tarefas",v:`${doneT}/${tasks.length}`,c:B.green},{l:"Estoque",v:stock.length,c:B.purple}].map(s=>(
            <div key={s.l} style={{textAlign:"center",background:B.gray800,borderRadius:7,padding:"3px 8px",border:`1px solid ${B.gray700}`}}>
              <div style={{fontSize:12,fontWeight:800,color:s.c}}>{s.v}</div><div style={{fontSize:9,color:B.gray400,whiteSpace:"nowrap"}}>{s.l}</div>
            </div>))}
          <button onClick={()=>{navigator.clipboard?.writeText(getMechanicPortalLink());toast_("Link da área do mecânico copiado ✓");}} title="Copiar link da área do mecânico" style={{width:34,height:34,borderRadius:8,background:`${B.orange}22`,border:`1px solid ${B.orange}44`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,marginLeft:4}}>
            <ILock s={16} c={B.orange}/>
          </button>
          <button onClick={()=>setSCfg(true)} style={{width:34,height:34,borderRadius:8,background:B.amberBg,border:`1px solid ${B.amber}44`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,marginLeft:4}}>
            <IGear2/>
          </button>
          <button onClick={()=>{setAdminRole(null);try{sessionStorage.removeItem(ADMIN_SESSION_KEY);}catch{}}} title="Sair (logout)" style={{width:34,height:34,borderRadius:8,background:`${B.red}1a`,border:`1px solid ${B.red}44`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,marginLeft:4}}>
            <ILogout s={16} c={B.red}/>
          </button>
        </div>
      </div>
    </div>

    <div style={{maxWidth:820,margin:"0 auto",padding:"20px 14px"}}>
      {/* Tabs */}
      <div style={{display:"flex",gap:3,marginBottom:20,background:B.gray900,padding:4,borderRadius:12,border:`1px solid ${B.gray700}`,width:"fit-content",flexWrap:"wrap"}}>
        {allowedTabs.includes("mechanics")&&tabBtn("mechanics","Mecânicos",<IWrench s={13}/>,B.orange)}
        {allowedTabs.includes("clients")&&tabBtn("clients","Clientes / OS",<IUser s={13}/>,B.blue)}
        {allowedTabs.includes("stock")&&tabBtn("stock","Estoque",<IWarehouse s={13}/>,B.purple)}
        {allowedTabs.includes("vehicles")&&tabBtn("vehicles","Veículos",<ICar s={13}/>,B.blue)}
        {allowedTabs.includes("clientsMonitor")&&tabBtn("clientsMonitor","Clientes",<IAddressBook s={13}/>,`#0891b2`)}
        {allowedTabs.includes("finance")&&tabBtn("finance","Financeiro",<IChart s={13}/>,B.green)}
      </div>

      {/* ══ MECHANICS ══ */}
      {tab==="mechanics"&&allowedTabs.includes("mechanics")&&<>
        <div style={{marginBottom:14,padding:"9px 13px",background:`${B.orange}11`,border:`1px solid ${B.orange}33`,borderRadius:9,fontSize:12,color:B.gray200}}>
          🔧 <b style={{color:B.orange}}>Visão do mecânico</b>: tarefas, material e tempo. Sem valores financeiros.
        </div>
        <div style={{background:B.gray800,borderRadius:12,padding:18,marginBottom:20,border:`1px solid ${B.gray700}`}}>
          <div style={{fontWeight:700,fontSize:11,color:B.orange,marginBottom:12,textTransform:"uppercase",letterSpacing:.6,display:"flex",alignItems:"center",gap:6}}><IWrench s={12} c={B.orange}/>Cadastrar Mecânico</div>
          <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
            <input value={eN} onChange={e=>setEN(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addEmp()} placeholder="Nome"
              style={{flex:"1 1 130px",padding:"8px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none"}}/>
            <input value={eP} onChange={e=>setEP(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addEmp()} placeholder="WhatsApp (5511999998888)"
              style={{flex:"1 1 180px",padding:"8px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none"}}/>
            <button onClick={addEmp} style={{padding:"8px 18px",borderRadius:8,background:B.orange,color:B.white,border:"none",cursor:"pointer",fontWeight:800,fontSize:13,display:"flex",alignItems:"center",gap:5}}
              onMouseEnter={e=>e.currentTarget.style.background=B.orangeD} onMouseLeave={e=>e.currentTarget.style.background=B.orange}>
              <IPlus s={13} c={B.white}/>Adicionar
            </button>
          </div>
        </div>
        {employees.length===0?<div style={{textAlign:"center",padding:"56px 0",color:B.gray400}}><div style={{fontSize:44,marginBottom:12}}>🔧</div><div style={{fontWeight:700,fontSize:15,color:B.gray200,marginBottom:4}}>Nenhum mecânico</div></div>
          :employees.map(emp=><EmployeeCard key={emp.id} employee={emp} vehicles={vehicles} tasks={tasks} employees={employees} clients={clients} stock={stock} defaultRate={defaultRate}
            onAddVehicle={addVeh} onDeleteVehicle={delVeh} onTransferMechanic={xferMech} onTransferOwner={xferOwn}
            onAddTask={addTask} onToggleTask={toggleT} onDeleteTask={delTask} onUpdateTask={updTask} onUpdateVehicle={updVeh}
            onConsumeStock={consumeStock} onReturnStock={returnStock}
            onAddMechanic={addVehicleMechanic} onRemoveMechanic={removeVehicleMechanic} onSetStatus={setVehicleStatus} isOwner={adminRole==="owner"}
            onDelete={delEmp} onSendWA={sendMechWA} onUpdatePhone={updEmpP} onUpdateName={updEmpN}/>)}
      </>}

      {/* ══ CLIENTS ══ */}
      {tab==="clients"&&allowedTabs.includes("clients")&&<>
        <div style={{marginBottom:14,padding:"9px 13px",background:B.amberBg,border:`1px solid ${B.amber}44`,borderRadius:9,fontSize:12,color:B.gray200}}>
          💰 <b style={{color:B.amber}}>Visão do gestor</b>: precificação completa, fotos da OS e link do cliente. Preço/h atual: <b style={{color:B.amber}}>{fmtBRL(defaultRate)}/h</b>
        </div>
        <div style={{background:B.gray800,borderRadius:12,padding:18,marginBottom:20,border:`1px solid ${B.gray700}`}}>
          <div style={{fontWeight:700,fontSize:11,color:B.blue,marginBottom:12,textTransform:"uppercase",letterSpacing:.6,display:"flex",alignItems:"center",gap:6}}><IUser s={12} c={B.blue}/>Cadastrar Cliente</div>
          <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
            <input value={cN} onChange={e=>setCN(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCli()} placeholder="Nome do cliente"
              style={{flex:"1 1 130px",padding:"8px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none"}}/>
            <input value={cP} onChange={e=>setCP(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCli()} placeholder="WhatsApp (5511999998888)"
              style={{flex:"1 1 180px",padding:"8px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none"}}/>
            <input value={cE} onChange={e=>setCE(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCli()} placeholder="E-mail (opcional)"
              style={{flex:"1 1 180px",padding:"8px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none"}}/>
            <button onClick={addCli} style={{padding:"8px 18px",borderRadius:8,background:B.blue,color:B.white,border:"none",cursor:"pointer",fontWeight:800,fontSize:13,display:"flex",alignItems:"center",gap:5}}
              onMouseEnter={e=>e.currentTarget.style.background=B.blueD} onMouseLeave={e=>e.currentTarget.style.background=B.blue}>
              <IPlus s={13} c={B.white}/>Adicionar
            </button>
          </div>
        </div>
        {clients.length===0?<div style={{textAlign:"center",padding:"56px 0",color:B.gray400}}><div style={{fontSize:44,marginBottom:12}}>👤</div><div style={{fontWeight:700,fontSize:15,color:B.gray200,marginBottom:4}}>Nenhum cliente</div><div style={{fontSize:13}}>Cadastre clientes para gerar OS e enviar progresso por WhatsApp.</div></div>
          :clients.map(cli=><ClientCard key={cli.id} client={cli} vehicles={vehicles} tasks={tasks} employees={employees} clients={clients} stock={stock} defaultRate={defaultRate} company={company}
            onUpdatePhone={updCliP} onUpdateName={updCliN} onUpdateEmail={updCliE} onDelete={delCli} onSendWA={sendCliWA}
            onTransferMechanic={xferMech} onTransferOwner={xferOwn}
            onToggleTask={toggleT} onDeleteTask={delTask} onAddTask={addTask} onUpdateTask={updTask} onUpdateVehicle={updVeh} onDeleteVehicle={delVeh}
            onConsumeStock={consumeStock} onReturnStock={returnStock}
            payments={payments} onAddPayment={addPayment} onDeletePayment={deletePayment}
            onAddMechanic={addVehicleMechanic} onRemoveMechanic={removeVehicleMechanic} onSetStatus={setVehicleStatus} isOwner={adminRole==="owner"}/>)}
      </>}

      {/* ══ STOCK ══ */}
      {tab==="stock"&&allowedTabs.includes("stock")&&<>
        <div style={{marginBottom:14,padding:"9px 13px",background:B.purpleBg,border:`1px solid ${B.purple}44`,borderRadius:9,fontSize:12,color:B.gray200}}>
          📦 <b style={{color:B.purple}}>Estoque</b>: gerencie produtos, preços e quantidades. Itens do estoque podem ser vinculados diretamente às tarefas de cada OS na aba Clientes.
        </div>
        <StockTab stock={stock} purchases={stockPurchases} onAdd={addStock} onUpdate={updStock} onDelete={delStock} onAddPurchase={addPurchase} onUpdatePurchase={updatePurchase} onDeletePurchase={deletePurchase}/>
      </>}

      {/* ══ FINANCE ══ */}
      {tab==="clientsMonitor"&&allowedTabs.includes("clientsMonitor")&&<>
        <div style={{marginBottom:14,padding:"9px 13px",background:`#0891b218`,border:`1px solid #0891b244`,borderRadius:9,fontSize:12,color:B.gray200}}>
          📋 <b style={{color:"#0891b2"}}>Clientes</b>: cadastro completo de clientes com contato e histórico de todos os veículos que já passaram pela oficina.
        </div>
        <ClientsMonitorTab clients={clients} vehicles={vehicles} tasks={tasks} employees={employees} defaultRate={defaultRate}
          onUpdateName={updCliN} onUpdatePhone={updCliP} onUpdateEmail={updCliE} onDelete={delCli}/>
      </>}
      {tab==="vehicles"&&allowedTabs.includes("vehicles")&&<>
        <div style={{marginBottom:14,padding:"9px 13px",background:B.blueBg,border:`1px solid ${B.blue}44`,borderRadius:9,fontSize:12,color:B.gray200}}>
          🚗 <b style={{color:B.blue}}>Veículos</b>: visão geral de todos os veículos, tempo na oficina e histórico de serviços realizados.
        </div>
        <VehiclesTab vehicles={vehicles} tasks={tasks} employees={employees} clients={clients} defaultRate={defaultRate} onUpdateVehicle={updVeh}/>
      </>}
      {tab==="finance"&&allowedTabs.includes("finance")&&<>
        <div style={{marginBottom:14,padding:"9px 13px",background:B.greenBg,border:`1px solid ${B.green}44`,borderRadius:9,fontSize:12,color:B.gray200}}>
          📊 <b style={{color:B.green}}>Financeiro dinâmico</b>: conforme os mecânicos marcam tarefas como concluídas, a receita e o lucro são contabilizados automaticamente aqui. Apenas o custo de material reduz o lucro.
        </div>
        <FinanceTab tasks={tasks} vehicles={vehicles} clients={clients} employees={employees} payments={payments} defaultRate={defaultRate}/>
      </>}
    </div>

    {modal&&<ShareModal {...modal} onClose={()=>setMod(null)}/>}
    {showCfg&&<SettingsPanel defaultRate={defaultRate} onSaveRate={saveRate} company={company} onSaveCompany={saveCompany} onClose={()=>setSCfg(false)}/>}
    {toast&&<Toast msg={toast} onDone={()=>setTst(null)}/>}
  </div>);
}
