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
function elapsedTime(enteredAt, endMs) {
  if (!enteredAt) return null;
  const ms = (endMs||Date.now()) - new Date(enteredAt).getTime();
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
  const laborGross = Number(t.hours||0)*rate;
  const discount = Math.min(Number(t.discount||0), laborGross); // per-task R$ discount on labor
  const labor = Math.max(0, laborGross - discount);
  const mats  = Array.isArray(t.materials) ? t.materials : [];
  const mat = mats.reduce((s,m)=>{
    const qty = Number(m.qty||1);
    const cost = Number(m.cost||0);
    if(m.fromStock){
      return s + cost*qty;
    } else {
      const markup = m.markup!=null ? Number(m.markup) : 50;
      const salePrice = cost*(1+markup/100);
      return s + salePrice*qty;
    }
  },0);
  const freight = mats.reduce((s,m)=>s+Number(m.freight||0),0);
  return {laborGross,discount,labor,mat,freight,total:labor+mat+freight};
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
const LOGO_B64 = "data:image/png;base64,/9j/4AAQSkZJRgABAQAAkACQAAD/4QD2RXhpZgAATU0AKgAAAAgABwEOAAIAAAALAAAAYgESAAMAAAABAAEAAAEaAAUAAAABAAAAbgEbAAUAAAABAAAAdgEoAAMAAAABAAIAAAEyAAIAAAAUAAAAfodpAAQAAAABAAAAkgAAAABTY3JlZW5zaG90AAAAAACQAAAAAQAAAJAAAAABMjAyNjowMzoxMCAxMjo1MTozNAAABJADAAIAAAAUAAAAyJKGAAcAAAASAAAA3KACAAQAAAABAAAEtqADAAQAAAABAAAEhgAAAAAyMDI2OjAzOjEwIDEyOjUxOjM0AEFTQ0lJAAAAU2NyZWVuc2hvdP/tADhQaG90b3Nob3AgMy4wADhCSU0EBAAAAAAAADhCSU0EJQAAAAAAENQdjNmPALIE6YAJmOz4Qn7/4gIoSUNDX1BST0ZJTEUAAQEAAAIYYXBwbAQAAABtbnRyUkdCIFhZWiAH5gABAAEAAAAAAABhY3NwQVBQTAAAAABBUFBMAAAAAAAAAAAAAAAAAAAAAAAA9tYAAQAAAADTLWFwcGwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAApkZXNjAAAA/AAAADBjcHJ0AAABLAAAAFB3dHB0AAABfAAAABRyWFlaAAABkAAAABRnWFlaAAABpAAAABRiWFlaAAABuAAAABRyVFJDAAABzAAAACBjaGFkAAAB7AAAACxiVFJDAAABzAAAACBnVFJDAAABzAAAACBtbHVjAAAAAAAAAAEAAAAMZW5VUwAAABQAAAAcAEQAaQBzAHAAbABhAHkAIABQADNtbHVjAAAAAAAAAAEAAAAMZW5VUwAAADQAAAAcAEMAbwBwAHkAcgBpAGcAaAB0ACAAQQBwAHAAbABlACAASQBuAGMALgAsACAAMgAwADIAMlhZWiAAAAAAAAD21QABAAAAANMsWFlaIAAAAAAAAIPfAAA9v////7tYWVogAAAAAAAASr8AALE3AAAKuVhZWiAAAAAAAAAoOAAAEQsAAMi5cGFyYQAAAAAAAwAAAAJmZgAA8qcAAA1ZAAAT0AAACltzZjMyAAAAAAABDEIAAAXe///zJgAAB5MAAP2Q///7ov///aMAAAPcAADAbv/AABEIBIYEtgMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2wBDAAICAgICAgMCAgMFAwMDBQYFBQUFBggGBgYGBggKCAgICAgICgoKCgoKCgoMDAwMDAwODg4ODg8PDw8PDw8PDw//2wBDAQICAgQEBAcEBAcQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/3QAEAEz/2gAMAwEAAhEDEQA/AP5/6KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/Q/n/ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9H+f+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/0v5/6KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/T/n/ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9T+f+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/1f5/6KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/W/n/ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9f+f+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/0P5/6KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/R/n/ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9L+f+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/0/5/6KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/U/n/ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9X+f+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/1v5/6KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/X/n/ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9D+f+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/0f5/6KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/S/n/ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9P+f+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/1P5/6KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/V/n/ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9b+f+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooo60AFFKATXYeDvAXjL4gapHovgzRrrWLyUgLHbxtIefXAwPxoA46iv1d+EP/BJD9oXx4sN941ktvCFjJgkTt5k+0/7C9Pxr9APBP/BGP4MaVHHJ448S6jrUowWWEiBCfw5oA/mjxRiv6/PD/wDwTO/ZA0JIwvgxb54/47mVpCT716pZ/sS/stWCqsHw60v5e7Qhj+tAH8V2DRX9sg/Y5/ZlH/NO9J/78Cnf8Md/szf9E70n/wAB1oA/iZor+2b/AIY7/Zm/6J3pP/gOtH/DHf7M3/RO9J/8B1oA/iZor+2b/hjv9mb/AKJ3pP8A4DrR/wAMd/szf9E70n/wHWgD+Jmiv7Zv+GO/2Zv+id6T/wCA60f8Md/szf8ARO9J/wDAdaAP4maK/tm/4Y7/AGZv+id6T/4DrR/wx3+zN/0TvSf/AAHWgD+Jmiv7Zv8Ahjv9mb/onek/+A60f8Md/szf9E70n/wHWgD+Jmiv7Zv+GO/2Zv8A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8BfBLwb4XtoxGtpp0G4Yx87qGbP4mvbqztMtVsbC1skGFt40jH0QAf0rRoAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAprelOpjUAfjH/wWY8VLp/wd8PeGUcb9Svd5GecIPSv5oq/bP8A4LO+MhqHxK8L+EIpPl061Mrp6M561+JlABXonwl8KS+OPiZ4Y8JRKWbVdQt4MDnh3ANed190/wDBOPwk3i79rjwTAY/Mi0+Z7yTjoIULA/nQB/Xn4a0iDQPD+naHaqFhsLeKBAPSNQv9K6Co15HpinigBaKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigApD0paRiAKAP53/8Agtd4mhn8S+AfCiMC9vFcXTDvzhRX4SV+l3/BVjxrL4p/ar1PSzIHi0C0htVx2JBZh+or80aACvrP9iDwMPiB+034G0GSPzYlvknkGM/LF83P5V8mV+uP/BHzwWuu/tEX3iWWPKaHYO6t6PJwKAP6ho41jRUQYVQAB6YqWkHSloAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigApD0OKWo5JFjiaRjhVBJ+goA/lV/wCCufiNdY/afOmROGTS7CGLg9C3zH+dfljX1j+294yXx1+07461yOTfEL54I8cjbD8v9K+TqACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/9L+f+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACv0Z/4JdeD08U/tV6FcTR+ZFpUb3J44BUcV+c46+tfuX/wRc8Dm78aeLfHEkYKWVutujEdGc84NAH9FgqSmAYNPoAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigApjcdOtPrM1i8TT9KvL922rbwvKT7IpNAH8i/wDwUv8AGg8Y/tV+JRE5eLTNtqvoNg5r8/q9h+P/AIml8X/GXxfr8rbjdajOQc54DkCvHqAFHWv2d/4Iw+CF1b4z+J/G0qZXRNO8pD6P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zwX4U1XxZrEohs9Jt5LiVm4ACLnH49KAP5iv+Cu3xBt/FX7Rcfhu0k3p4dtEgbB4EjcsK/KGvWvjp8Qrj4p/FjxN46uHL/2reyypk5whY7R+VeS0AFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAH/0/5/6KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKmgkMMqSr95GDD6jmoaUY70Af2o/sXfEG0+JH7N3grX7eYSuljHby4OcSQjaQfyr6pzX83v/AASW/as0/wAE67c/AfxpeLb2GtSebpssjYVbjvHknA3dvev6PUbOOc5GeKAJqKQEGloAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKM0UwkA5oAUsADivkL9tH9pHRf2bvgvqviWadRrmoRva6XBn53uHUjcB/dQHJPrivXvjT8bfh/8AAbwRfeOviJqSWFjao2xMjzZ5McRxL1Zia/kS/a3/AGqfGH7U3xKuPFutk2mj2xMWm2AYlLeAHjPq7dWPc0AfNGuazqHiHV7zXNVlae7vpXmldjks7nJOayKUnNJQAV0HhTWJPDvibSdfjOG067guB/2ycN/SufpwIxg80Af3c/C3xdp3jj4e+HvFmlyia21OxgmVh/tIM/rXoNfh7/wSU/at0/XvBx/Z98XXix6to259LMjYM1uxz5YJPVOw9K/b5TQBJRR1ooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKDRUbPxx3oAGbGMV+aX/BSn9qWz+BnwfuvCOiXYHirxTG1vAin54oGGHkPcccCvo/9p79qP4e/syeB7jxJ4ru0l1KVGFlYKw864lx8ox2XPU1/Ib8ePjj40+P/wARNR+IPjS5aae7c+TFk7IIv4Y0HYAUAeOzSyTSNNMdzuxYn1J5JqGlyaSgAr3n9mbxx/wrr46eDvFrOEjtL+IOT0CMQDXg1SxSvDKksZ2uhDAjsR0NAH98Wkalb6tplpqds4eG6iSVWHQhxkYrVzX5gf8ABNP9qrTfjX8JrTwLrl6o8VeGI1geNj880CjCuM9cd8V+nec80ASUUUUAFFFFABRRRQAUUUUAFFFF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gH3/APr3ge0vuX+Z+02RSZ9K/Fr/AIbl+On/AD82X/gKlH/DcnxzPBuLH/wFSheGmY94/f8A8AP9fMD2l9y/zOX/AGwNf/t/48+INjb4tOEFohz/AM84wzfk7MK+Ya3fEevah4o1zUfEWruJL3U55LmZhwC8rFmwB0GTwO1YVfuOW4P6vh6dD+VJfcj8izDE+2rzq/zNsKKKK7TjCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//0v5/6KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/T/n/ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9T+f+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/1f5/6KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/W/n/ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9f+f+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/0P5/6KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/R/n/ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9L+f+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/0/5/6KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/U/n/ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9X+f+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/1v5/6KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/X/n/ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9D+f+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/0f5/6KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/S/n/ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9P+f+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/1P5/6KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/V/n/ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9b+f+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/1/5/6KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/Z";

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

async function generateQuotePDF(vehicle, tasks, client, employee, company, defaultRate, tasksOverride) {
  const jsPDFCtor = await loadJsPDF();
  const doc = new jsPDFCtor({ unit: "mm", format: "a4" });
  const pageW = 210, marginX = 14, contentW = pageW - marginX * 2;
  let y = 0;

  const orange = [255,107,0], black = [20,20,20], gray = [100,100,100],
        lightGray = [242,242,242], white = [255,255,255];

  // ── Header band ──────────────────────────────────────────────────────────────
  doc.setFillColor(...black);
  doc.rect(0, 0, pageW, 38, "F");
  doc.setFillColor(...orange);
  doc.rect(0, 36, pageW, 2, "F");

  // Logo on the left — black rect behind ensures transparency blends correctly
  doc.setFillColor(...black);
  doc.rect(marginX, 2, 32, 32, "F");
  try {
    doc.addImage(LOGO_B64, "PNG", marginX, 2, 32, 32);
  } catch(e) {
    doc.setTextColor(...white);
    doc.setFont("helvetica","bold"); doc.setFontSize(18);
    doc.text("OSC", marginX, 22);
  }

  // Company info to the right of logo
  const infoX = marginX + 36;
  doc.setTextColor(...white);
  doc.setFont("helvetica","bold"); doc.setFontSize(13);
  doc.text(company?.name || "OSC Performance", infoX, 13);
  doc.setFont("helvetica","normal"); doc.setFontSize(8);
  doc.setTextColor(210,210,210);
  let hY = 20;
  if (company?.address) { doc.text(company.address, infoX, hY); hY += 5; }
  const contact = [company?.phone&&`Tel: ${company.phone}`, company?.document&&`CNPJ: ${company.document}`].filter(Boolean).join("   ");
  if (contact) doc.text(contact, infoX, hY);

  // Emission date (far right)
  doc.setFont("helvetica","italic"); doc.setFontSize(8); doc.setTextColor(180,180,180);
  doc.text(`Emitido em ${fmtD()}`, pageW - marginX, 30, { align: "right" });

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

  // Plate + color + mechanic on same row, right column
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...gray);
  const plateText = `Placa: ${vehicle.plate}${vehicle.year ? `  · Ano: ${vehicle.year}` : ""}${vehicle.color ? `  · Cor: ${vehicle.color}` : ""}`;
  doc.text(plateText, rx, y + 20);
  if (employee?.name) {
    doc.text(`Mec: ${employee.name}`, rx, y + 26);
  }

  y += boxH + 8;

  // ── Table ────────────────────────────────────────────────────────────────────
  // Columns: desc (stretchy) | qty | unit | desc | total
  const cQty   = marginX + contentW - 100;
  const cUnit  = marginX + contentW - 70;
  const cDisc  = marginX + contentW - 38;
  const cTotal = marginX + contentW - 4;
  const cDescW = cQty - marginX - 8;

  const drawTableHeader = () => {
    doc.setFillColor(...orange);
    doc.rect(marginX, y, contentW, 8, "F");
    doc.setTextColor(...white); doc.setFont("helvetica","bold"); doc.setFontSize(8);
    doc.text("SERVIÇO / MATERIAL", marginX + 3, y + 5.5);
    doc.text("QTD/H",  cQty,   y + 5.5, { align: "right" });
    doc.text("UNIT.",  cUnit,  y + 5.5, { align: "right" });
    doc.text("DESC.",  cDisc,  y + 5.5, { align: "right" });
    doc.text("TOTAL",  cTotal, y + 5.5, { align: "right" });
    y += 8;
    // Breathing space below header
    y += 3;
  };

  const checkPageBreak = (needed = 10) => {
    if (y + needed > 282) {
      doc.addPage();
      y = 16;
      drawTableHeader();
    }
  };

  drawTableHeader();

  let laborTotal = 0, partsTotal = 0, freightTotal = 0;
  const ts = tasksOverride || tasks.filter(t => t.vehicleId === vehicle.id);
  const fuelCostVal = Number(vehicle.fuelCost || 0);
  const tows = Array.isArray(vehicle.tows) ? vehicle.tows : [];
  const towTotal = tows.reduce((s,t)=>s+Number(t.value||0),0);

  // Group tasks by category in PDF
  const catOrder=[];
  const catSeen=new Set();
  ts.forEach(t=>{
    const key=t.category||"__none__";
    if(!catSeen.has(key)){catSeen.add(key);catOrder.push(t.category||null);}
  });

  catOrder.forEach(cat=>{
    const groupTasks=ts.filter(t=>(t.category||null)===cat);
    // Category header row
    if(cat){
      checkPageBreak(10);
      const hexStr=CAT_MAP[cat]||"#6b7280";
      const rgb=[parseInt(hexStr.slice(1,3),16),parseInt(hexStr.slice(3,5),16),parseInt(hexStr.slice(5,7),16)];
      doc.setFillColor(Math.round(rgb[0]*.15+240*.85),Math.round(rgb[1]*.15+240*.85),Math.round(rgb[2]*.15+240*.85));
      doc.setDrawColor(...rgb); doc.setLineWidth(0.5);
      doc.rect(marginX, y, contentW, 6, "FD"); doc.setLineWidth(0.2);
      doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(...rgb);
      doc.text(`> ${cat.toUpperCase()}`, marginX + 3, y + 4.2);
      y += 7;
    }
    groupTasks.forEach((t, idx) => {
    const c = taskCost(t, defaultRate);
    laborTotal += c.labor;
    partsTotal += c.mat;
    freightTotal += c.freight || 0;

    const mats = t.materials || [];
    const rate  = t.ratePerHour != null ? Number(t.ratePerHour) : Number(defaultRate || 0);
    const isOutsourced = !!t.outsourced;

    doc.setFont("helvetica","bold"); doc.setFontSize(9);
    const labelText = isOutsourced ? `[Terceirizado] ${t.label}` : t.label;
    const labelLines = doc.splitTextToSize(labelText, cDescW);

    const matTextLines = mats.map(m => {
      const qty = m.qty || 1;
      const freight = Number(m.freight || 0);
      const txt = `· ${m.name}${m.fromStock?" (estoque)":""}${qty>1?` ×${qty}`:""}${freight>0?` + frete ${fmtBRL(freight)}`:""}`;
      doc.setFont("helvetica","normal"); doc.setFontSize(8);
      return { lines: doc.splitTextToSize(txt, cDescW - 6), mat: m, qty, freight };
    });

    const labelH  = labelLines.length * 5;
    const matsH   = matTextLines.reduce((s, ml) => s + ml.lines.length * 4.5, 0);
    const rowH    = Math.max(9, labelH + (mats.length > 0 ? matsH + 3 : 0) + 4);

    checkPageBreak(rowH + 2);

    if (isOutsourced) {
      doc.setFillColor(237, 233, 254);
    } else {
      doc.setFillColor(idx % 2 === 0 ? 255 : 249, idx % 2 === 0 ? 255 : 249, idx % 2 === 0 ? 255 : 249);
    }
    doc.setDrawColor(225, 225, 225);
    doc.rect(marginX, y, contentW, rowH, "FD");

    doc.setFont("helvetica","bold"); doc.setFontSize(9);
    const labelColor = isOutsourced ? [109, 40, 217] : black;
    doc.setTextColor(...labelColor);
    labelLines.forEach((line, li) => doc.text(line, marginX + 3, y + 5 + li * 5));

    doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...gray);
    if (t.hours > 0) doc.text(`${t.hours}h`, cQty, y + 5, { align: "right" });
    doc.text(t.hours > 0 ? fmtBRL(rate) : "—", cUnit, y + 5, { align: "right" });
    // DESC column — per-task discount
    if (c.discount > 0) {
      doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(180, 60, 60);
      doc.text(`-${fmtBRL(c.discount)}`, cDisc, y + 5, { align: "right" });
    } else {
      doc.setTextColor(...gray);
      doc.text("—", cDisc, y + 5, { align: "right" });
    }
    // TOTAL column
    doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...black);
    doc.text(fmtBRL(c.labor), cTotal, y + 5, { align: "right" });

    let matY = y + 5 + labelLines.length * 5;
    matTextLines.forEach(({ lines, mat, qty, freight }) => {
      const matCost = Number(mat.cost || 0);
      const markup = mat.markup != null ? Number(mat.markup) : 50;
      const unitPrice = mat.fromStock ? matCost : matCost * (1 + markup / 100);
      const matSubtotal = unitPrice * qty;
      const matTotal = matSubtotal + freight;
      doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...gray);
      lines.forEach((line, li) => doc.text(line, marginX + 7, matY + li * 4.5));
      doc.text(`${qty}x`, cQty, matY, { align: "right" });
      doc.text(fmtBRL(unitPrice), cUnit, matY, { align: "right" });
      // DESC: show freight if any, else dash
      if (freight > 0) {
        doc.setTextColor(100, 120, 160);
        doc.text(`+${fmtBRL(freight)}`, cDisc, matY, { align: "right" });
      } else {
        doc.setTextColor(...gray);
        doc.text("—", cDisc, matY, { align: "right" });
      }
      doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(180, 100, 0);
      doc.text(fmtBRL(matTotal), cTotal, matY, { align: "right" });
      matY += lines.length * 4.5;
    });

    y += rowH + 1;
    }); // groupTasks.forEach
    // Breathing space after each category group
    y += 3;
  }); // catOrder.forEach

  // Fuel cost row
  if (fuelCostVal > 0) {
    checkPageBreak(10);
    doc.setFillColor(254, 249, 236);
    doc.setDrawColor(225, 225, 225);
    doc.rect(marginX, y, contentW, 8, "FD");
    doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...gray);
    doc.text("Combustivel", marginX + 3, y + 5.5);
    doc.text("—", cDisc, y + 5.5, { align: "right" });
    doc.setFont("helvetica","bold"); doc.setTextColor(...black);
    doc.text(fmtBRL(fuelCostVal), cTotal, y + 5.5, { align: "right" });
    y += 9;
  }

  tows.forEach((tow,ti)=>{
    if(!tow.value) return;
    checkPageBreak(10);
    doc.setFillColor(236, 246, 254);
    doc.setDrawColor(225, 225, 225);
    doc.rect(marginX, y, contentW, 8, "FD");
    const origin = tow.origin || "";
    const dest   = tow.destination || "";
    const route  = origin && dest ? ` (${origin} -> ${dest})` : origin ? ` (${origin})` : dest ? ` (-> ${dest})` : "";
    const towLabel = `Reboque #${ti+1}${route}`;
    doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...gray);
    const towLines = doc.splitTextToSize(towLabel, cDescW);
    towLines.forEach((line, li) => doc.text(line, marginX + 3, y + 5.5 + li * 4));
    doc.text("—", cDisc, y + 5.5, { align: "right" });
    doc.setFont("helvetica","bold"); doc.setTextColor(...black);
    doc.text(fmtBRL(Number(tow.value||0)), cTotal, y + 5.5, { align: "right" });
    y += 9;
  });

  y += 5;
  checkPageBreak(50);

  // ── Totals box ───────────────────────────────────────────────────────────────
  const osDiscountPct = Number(vehicle.osDiscountPct || 0);
  const laborSumForDiscount = ts.reduce((s,t)=>s+taskCost(t,defaultRate).labor,0);
  const osDiscountAmt = laborSumForDiscount * osDiscountPct / 100;
  const grandTotal = partsTotal + freightTotal + laborTotal + fuelCostVal + towTotal - osDiscountAmt;
  const extraLines = (freightTotal > 0 ? 1 : 0) + (fuelCostVal > 0 ? 1 : 0) + (towTotal > 0 ? 1 : 0) + (osDiscountAmt > 0 ? 1 : 0);
  const boxH_inner = 26 + extraLines * 8;
  const boxW = 85, boxX = pageW - marginX - boxW;
  doc.setDrawColor(220,220,220);
  doc.setFillColor(250,250,250);
  doc.roundedRect(boxX, y, boxW, boxH_inner, 2, 2, "FD");

  doc.setFontSize(9); doc.setFont("helvetica","normal"); doc.setTextColor(...gray);
  doc.text("Total de Pecas/Materiais",  boxX + 5, y + 9);
  doc.text("Total de Mao de Obra",      boxX + 5, y + 17);
  let nextY = 25;
  if (freightTotal  > 0) { doc.text("Total de Frete",                    boxX + 5, y + nextY); nextY += 8; }
  if (fuelCostVal   > 0) { doc.text("Combustivel",                       boxX + 5, y + nextY); nextY += 8; }
  if (towTotal      > 0) { doc.text("Reboque",                           boxX + 5, y + nextY); nextY += 8; }
  if (osDiscountAmt > 0) { doc.setTextColor(180, 60, 60); doc.text(`Desconto (${osDiscountPct}% m.o.)`, boxX + 5, y + nextY); doc.setTextColor(...black); nextY += 8; }

  doc.setFont("helvetica","bold"); doc.setTextColor(...black);
  doc.text(fmtBRL(partsTotal),  boxX + boxW - 5, y + 9,  { align: "right" });
  doc.text(fmtBRL(laborTotal),  boxX + boxW - 5, y + 17, { align: "right" });
  let nextY2 = 25;
  if (freightTotal  > 0) { doc.text(fmtBRL(freightTotal),            boxX + boxW - 5, y + nextY2, { align: "right" }); nextY2 += 8; }
  if (fuelCostVal   > 0) { doc.text(fmtBRL(fuelCostVal),             boxX + boxW - 5, y + nextY2, { align: "right" }); nextY2 += 8; }
  if (towTotal      > 0) { doc.text(fmtBRL(towTotal),                boxX + boxW - 5, y + nextY2, { align: "right" }); nextY2 += 8; }
  if (osDiscountAmt > 0) { doc.setTextColor(180, 60, 60); doc.text(`-${fmtBRL(osDiscountAmt)}`, boxX + boxW - 5, y + nextY2, { align: "right" }); doc.setTextColor(...black); nextY2 += 8; }

  doc.setDrawColor(...orange); doc.setLineWidth(0.4);
  doc.line(boxX + 5, y + nextY2 - 2, boxX + boxW - 5, y + nextY2 - 2);
  doc.setLineWidth(0.2);

  doc.setFillColor(...orange);
  doc.roundedRect(boxX, y + nextY2, boxW, 11, 2, 2, "F");
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...white);
  doc.text("TOTAL GERAL", boxX + 5, y + nextY2 + 7);
  doc.text(fmtBRL(grandTotal), boxX + boxW - 5, y + nextY2 + 7, { align: "right" });

  y += boxH_inner + 13;

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

// Priority config
const CATEGORIES=[
  {id:"Suspensão",  color:"#f59e0b"},
  {id:"Motor",      color:"#ef4444"},
  {id:"Powertrain", color:"#f97316"},
  {id:"Interior",   color:"#8b5cf6"},
  {id:"Exterior",   color:"#06b6d4"},
  {id:"Pintura",    color:"#ec4899"},
  {id:"Acabamento", color:"#14b8a6"},
  {id:"Elétrica",   color:"#eab308"},
  {id:"Eletrônica", color:"#6366f1"},
  {id:"Direção",    color:"#10b981"},
  {id:"Adaptação",  color:"#64748b"},
  {id:"Chassi",     color:"#78716c"},
];
const CAT_MAP=Object.fromEntries(CATEGORIES.map(c=>[c.id,c.color]));

const PRIORITY={
  high:  {label:"Alta",    color:"#ef4444", bg:"#ef444418", border:"#ef444444", next:"medium"},
  medium:{label:"Média",   color:"#f59e0b", bg:"#f59e0b18", border:"#f59e0b44", next:"low"},
  low:   {label:"Baixa",   color:"#6b7280", bg:"#6b728018", border:"#6b728044", next:"high"},
};
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

// ─── Category components ──────────────────────────────────────────────────────
function CategoryPill({category,size=10}) {
  if(!category) return null;
  const color=CAT_MAP[category]||B.gray500;
  return <span style={{fontSize:size,fontWeight:700,color,background:color+"22",border:`1px solid ${color}44`,borderRadius:5,padding:"1px 6px",flexShrink:0,whiteSpace:"nowrap"}}>{category}</span>;
}

function CategorySelect({value,onChange}) {
  const [open,setOpen]=useState(false);
  const ref=useRef(null);
  useEffect(()=>{
    const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    document.addEventListener("mousedown",h);
    return()=>document.removeEventListener("mousedown",h);
  },[]);
  const color=value?CAT_MAP[value]||B.gray500:B.gray500;
  return (<div ref={ref} style={{position:"relative",flexShrink:0}}>
    <button onClick={()=>setOpen(o=>!o)} style={{background:value?color+"22":"none",border:`1px solid ${value?color+"44":B.gray600}`,borderRadius:5,padding:"1px 7px",cursor:"pointer",color:value?color:B.gray500,fontSize:9,fontWeight:700,display:"flex",alignItems:"center",gap:3,whiteSpace:"nowrap"}}>
      {value||"Categoria"}{open?<IChevU s={8}/>:<IChevD s={8}/>}
    </button>
    {open&&<div style={{position:"absolute",top:"100%",left:0,zIndex:50,background:B.gray800,border:`1px solid ${B.gray600}`,borderRadius:8,padding:4,minWidth:140,boxShadow:"0 8px 24px rgba(0,0,0,.5)",maxHeight:220,overflowY:"auto",marginTop:3}}>
      {value&&<button onClick={()=>{onChange(null);setOpen(false);}} style={{width:"100%",textAlign:"left",padding:"4px 8px",borderRadius:5,background:"none",border:"none",cursor:"pointer",color:B.gray400,fontSize:10,marginBottom:2}}>
        ✕ Sem categoria
      </button>}
      {CATEGORIES.map(c=>(
        <button key={c.id} onClick={()=>{onChange(c.id);setOpen(false);}}
          style={{width:"100%",textAlign:"left",padding:"5px 8px",borderRadius:5,background:value===c.id?c.color+"22":"none",border:"none",cursor:"pointer",color:c.color,fontSize:11,fontWeight:700,display:"flex",alignItems:"center",gap:6}}>
          <span style={{width:8,height:8,borderRadius:99,background:c.color,flexShrink:0}}/>
          {c.id}
        </button>
      ))}
    </div>}
  </div>);
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

// ─── Vehicle picker modal — pick existing or create new ──────────────────────
function VehiclePickerModal({vehicles,employees,clients,employeeId,onPickExisting,onCreateNew,onClose}) {
  const [q,setQ]=useState("");
  // Show all vehicles not already assigned to this mechanic
  const available=vehicles.filter(v=>
    !(v.mechanicIds||[v.employeeId]).includes(employeeId) &&
    (v.model.toLowerCase().includes(q.toLowerCase())||v.plate.toLowerCase().includes(q.toLowerCase()))
  );
  return (<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:90,padding:16}} onClick={onClose}>
    <div style={{background:B.gray800,borderRadius:16,maxWidth:440,width:"100%",overflow:"hidden",border:`1px solid ${B.orange}55`,maxHeight:"80vh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
      <div style={{padding:"14px 18px",background:B.gray900,borderBottom:`2px solid ${B.orange}`,display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
        <div style={{width:34,height:34,borderRadius:8,background:`${B.orange}22`,display:"flex",alignItems:"center",justifyContent:"center"}}><ICar s={16} c={B.orange}/></div>
        <div><div style={{fontWeight:700,fontSize:14,color:B.white}}>Adicionar veículo</div><div style={{fontSize:12,color:B.gray400}}>Escolha um existente ou cadastre novo</div></div>
        <button onClick={onClose} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:B.gray400}}><IX s={18}/></button>
      </div>
      <div style={{padding:"12px 16px",borderBottom:`1px solid ${B.gray700}`,flexShrink:0}}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar por modelo ou placa…" autoFocus
          style={{width:"100%",padding:"8px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
      </div>
      <div style={{padding:12,overflowY:"auto",flex:1}}>
        {available.length===0&&q&&<div style={{textAlign:"center",padding:"16px 0",color:B.gray400,fontSize:13}}>Nenhum veículo encontrado.</div>}
        {available.map(v=>{
          const cli=clients.find(c=>c.id===v.clientId);
          const hasOS=!!v.enteredAt;
          return (<button key={v.id} onClick={()=>onPickExisting(v.id)} style={{width:"100%",textAlign:"left",padding:"10px 12px",borderRadius:9,background:B.gray700,border:`1px solid ${B.gray600}`,color:B.white,cursor:"pointer",marginBottom:6,display:"flex",alignItems:"center",gap:9}}
            onMouseEnter={e=>{e.currentTarget.style.background=`${B.orange}22`;e.currentTarget.style.borderColor=B.orange;}}
            onMouseLeave={e=>{e.currentTarget.style.background=B.gray700;e.currentTarget.style.borderColor=B.gray600;}}>
            <div style={{width:32,height:32,borderRadius:7,background:`${B.orange}22`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              {v.photo?<img src={v.photo} alt="" style={{width:32,height:32,objectFit:"cover",borderRadius:7}}/>:<ICar s={17} c={B.orange}/>}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:700,fontSize:13,color:B.white}}>{v.model}</div>
              <div style={{fontSize:11,color:B.gray400,display:"flex",gap:6,flexWrap:"wrap"}}>
                <span style={{fontFamily:"monospace"}}>{v.plate}</span>
                {v.osNumber&&<span style={{color:B.orange}}>{fmtOS(v.osNumber)}</span>}
                {cli&&<span>👤 {cli.name}</span>}
                {hasOS&&<span style={{color:B.amber}}>● OS aberta</span>}
              </div>
            </div>
          </button>);
        })}
        {!q&&available.length===0&&<div style={{textAlign:"center",padding:"12px 0",color:B.gray400,fontSize:13}}>Todos os veículos já estão atribuídos a você.</div>}
      </div>
      <div style={{padding:12,borderTop:`1px solid ${B.gray700}`,flexShrink:0}}>
        <button onClick={onCreateNew} style={{width:"100%",padding:"10px 0",borderRadius:9,background:`${B.orange}22`,border:`1px solid ${B.orange}44`,color:B.orange,cursor:"pointer",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
          <IPlus s={14} c={B.orange}/>Cadastrar novo veículo
        </button>
      </div>
    </div>
  </div>);
}

// ─── Open OS modal — select mechanic and open new OS on existing vehicle ──────
function OpenOSModal({vehicle,employees,onConfirm,onClose}) {
  const [selectedEmp,setSelectedEmp]=useState(null);
  const [entryInput,setEntryInput]=useState(new Date().toISOString().slice(0,16));
  return (<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:90,padding:16}} onClick={onClose}>
    <div style={{background:B.gray800,borderRadius:16,maxWidth:420,width:"100%",overflow:"hidden",border:`1px solid ${B.green}55`,maxHeight:"80vh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
      <div style={{padding:"14px 18px",background:B.gray900,borderBottom:`2px solid ${B.green}`,display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
        <div style={{width:34,height:34,borderRadius:8,background:B.greenBg,display:"flex",alignItems:"center",justifyContent:"center"}}><IFileText s={16} c={B.green}/></div>
        <div>
          <div style={{fontWeight:700,fontSize:14,color:B.white}}>Abrir nova OS</div>
          <div style={{fontSize:12,color:B.gray400}}>{vehicle.model} · {vehicle.plate}</div>
        </div>
        <button onClick={onClose} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:B.gray400}}><IX s={18}/></button>
      </div>
      <div style={{padding:16,overflowY:"auto",flex:1}}>
        <div style={{marginBottom:14}}>
          <FieldLabel>Data/hora de entrada</FieldLabel>
          <input value={entryInput} onChange={e=>setEntryInput(e.target.value)} type="datetime-local"
            style={{width:"100%",padding:"9px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
        </div>
        <FieldLabel>Selecione o mecânico responsável</FieldLabel>
        <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:6}}>
          {employees.map(emp=>(
            <button key={emp.id} onClick={()=>setSelectedEmp(emp.id)}
              style={{textAlign:"left",padding:"10px 12px",borderRadius:9,background:selectedEmp===emp.id?B.greenBg:B.gray700,border:`1px solid ${selectedEmp===emp.id?B.green:B.gray600}`,color:B.white,cursor:"pointer",display:"flex",alignItems:"center",gap:9}}>
              <div style={{width:30,height:30,borderRadius:7,background:`${B.orange}22`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><IWrench s={14} c={B.orange}/></div>
              <div>
                <div style={{fontWeight:700,fontSize:13}}>{emp.name}</div>
                {emp.phone&&<div style={{fontSize:11,color:B.gray400}}>{emp.phone}</div>}
              </div>
              {selectedEmp===emp.id&&<span style={{marginLeft:"auto",color:B.green,fontWeight:700}}>✓</span>}
            </button>
          ))}
        </div>
      </div>
      <div style={{padding:12,borderTop:`1px solid ${B.gray700}`,flexShrink:0}}>
        <button onClick={()=>selectedEmp&&onConfirm(selectedEmp,entryInput)} disabled={!selectedEmp}
          style={{width:"100%",padding:"10px 0",borderRadius:9,background:selectedEmp?B.green:B.gray700,border:"none",color:B.white,cursor:selectedEmp?"pointer":"not-allowed",fontWeight:800,fontSize:14}}>
          Abrir OS
        </button>
      </div>
    </div>
  </div>);
}


// ─── Create Vehicle modal — from Vehicles tab ─────────────────────────────────
function CreateVehicleModal({clients,onConfirm,onClose}) {
  const [model,setModel]=useState("");
  const [plate,setPlate]=useState("");
  const [color,setColor]=useState("");
  const [year,setYear]=useState("");
  const [clientMode,setClientMode]=useState("none"); // "none" | "existing" | "new"
  const [selectedClientId,setSelectedClientId]=useState("");
  const [clientSearch,setClientSearch]=useState("");
  const [newName,setNewName]=useState("");
  const [newPhone,setNewPhone]=useState("");
  const [newEmail,setNewEmail]=useState("");

  const filteredClients=clients.filter(c=>
    c.name.toLowerCase().includes(clientSearch.toLowerCase())||
    (c.phone||"").includes(clientSearch)
  );

  const canSave=model.trim()&&plate.trim()&&
    (clientMode==="none"||
     (clientMode==="existing"&&selectedClientId)||
     (clientMode==="new"&&newName.trim()));

  const confirm=()=>{
    if(!canSave) return;
    onConfirm({
      model,plate,color,year:year?parseInt(year):null,
      clientId:clientMode==="existing"?selectedClientId:null,
      newClient:clientMode==="new"?{name:newName,phone:newPhone,email:newEmail}:null,
    });
  };

  return (<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:90,padding:16}} onClick={onClose}>
    <div style={{background:B.gray800,borderRadius:16,maxWidth:480,width:"100%",overflow:"hidden",border:`1px solid ${B.orange}55`,maxHeight:"90vh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>

      {/* Header */}
      <div style={{padding:"14px 18px",background:B.gray900,borderBottom:`2px solid ${B.orange}`,display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
        <div style={{width:34,height:34,borderRadius:8,background:`${B.orange}22`,display:"flex",alignItems:"center",justifyContent:"center"}}><ICar s={17} c={B.orange}/></div>
        <div style={{fontWeight:700,fontSize:14,color:B.white}}>Novo veículo</div>
        <button onClick={onClose} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:B.gray400}}><IX s={18}/></button>
      </div>

      <div style={{padding:18,overflowY:"auto",flex:1}}>
        {/* Vehicle fields */}
        <div style={{marginBottom:14}}>
          <FieldLabel>Modelo do veículo</FieldLabel>
          <input value={model} onChange={e=>setModel(e.target.value)} placeholder="Ex: Honda Civic 2022" autoFocus
            style={{width:"100%",padding:"9px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
        </div>
        <div style={{marginBottom:14}}>
          <FieldLabel>Placa</FieldLabel>
          <input value={plate} onChange={e=>setPlate(e.target.value.toUpperCase())} placeholder="Ex: ABC-1234"
            style={{width:"100%",padding:"9px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none",boxSizing:"border-box",fontFamily:"monospace",letterSpacing:1}}/>
        </div>
        <div style={{marginBottom:18}}>
          <FieldLabel>Cor (opcional)</FieldLabel>
          <input value={color} onChange={e=>setColor(e.target.value)} placeholder="Ex: Preto, Branco Perolado, Azul Metálico…"
            style={{width:"100%",padding:"9px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
        </div>
        <div style={{marginBottom:18}}>
          <FieldLabel>Ano (opcional)</FieldLabel>
          <input value={year} onChange={e=>setYear(e.target.value)} placeholder="Ex: 2021" maxLength={4} type="number"
            style={{width:"100%",padding:"9px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
        </div>

        {/* Client section */}
        <div style={{paddingTop:14,borderTop:`1px solid ${B.gray700}`}}>
          <div style={{fontSize:11,color:B.gray300,fontWeight:700,marginBottom:10,textTransform:"uppercase",letterSpacing:.5}}>Cliente (opcional)</div>

          {/* Mode selector */}
          <div style={{display:"flex",gap:6,marginBottom:12}}>
            {[["none","Sem cliente"],["existing","Existente"],["new","Novo cliente"]].map(([val,lbl])=>(
              <button key={val} onClick={()=>setClientMode(val)}
                style={{flex:1,padding:"7px 0",borderRadius:8,border:`1px solid ${clientMode===val?B.orange:B.gray600}`,background:clientMode===val?`${B.orange}22`:B.gray700,color:clientMode===val?B.orange:B.gray300,cursor:"pointer",fontWeight:600,fontSize:12}}>
                {lbl}
              </button>
            ))}
          </div>

          {/* Existing client picker */}
          {clientMode==="existing"&&<>
            <input value={clientSearch} onChange={e=>setClientSearch(e.target.value)} placeholder="Buscar cliente por nome ou telefone…"
              style={{width:"100%",padding:"8px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none",boxSizing:"border-box",marginBottom:8}}/>
            <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:180,overflowY:"auto"}}>
              {filteredClients.length===0&&<div style={{textAlign:"center",padding:"12px 0",color:B.gray500,fontSize:13}}>Nenhum cliente encontrado.</div>}
              {filteredClients.map(c=>(
                <button key={c.id} onClick={()=>setSelectedClientId(c.id)}
                  style={{textAlign:"left",padding:"9px 12px",borderRadius:8,border:`1px solid ${selectedClientId===c.id?B.blue:B.gray600}`,background:selectedClientId===c.id?B.blueBg:B.gray700,color:B.white,cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
                  <IUser s={14} c={selectedClientId===c.id?B.blue:B.gray400}/>
                  <div>
                    <div style={{fontWeight:600,fontSize:13}}>{c.name}</div>
                    {c.phone&&<div style={{fontSize:11,color:B.gray400}}>{c.phone}</div>}
                  </div>
                  {selectedClientId===c.id&&<span style={{marginLeft:"auto",color:B.blue,fontWeight:700}}>✓</span>}
                </button>
              ))}
            </div>
          </>}

          {/* New client form */}
          {clientMode==="new"&&<div style={{display:"flex",flexDirection:"column",gap:9}}>
            <div>
              <FieldLabel>Nome do cliente</FieldLabel>
              <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Nome completo"
                style={{width:"100%",padding:"9px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
            </div>
            <div>
              <FieldLabel>WhatsApp (opcional)</FieldLabel>
              <input value={newPhone} onChange={e=>setNewPhone(e.target.value)} placeholder="5511999998888"
                style={{width:"100%",padding:"9px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
            </div>
            <div>
              <FieldLabel>E-mail (opcional)</FieldLabel>
              <input value={newEmail} onChange={e=>setNewEmail(e.target.value)} placeholder="email@exemplo.com"
                style={{width:"100%",padding:"9px 12px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
            </div>
          </div>}
        </div>
      </div>

      {/* Footer */}
      <div style={{padding:"12px 18px",borderTop:`1px solid ${B.gray700}`,flexShrink:0}}>
        <button onClick={confirm} disabled={!canSave}
          style={{width:"100%",padding:"11px 0",borderRadius:9,background:canSave?B.orange:B.gray700,border:"none",color:B.white,fontWeight:800,fontSize:14,cursor:canSave?"pointer":"not-allowed"}}>
          Cadastrar veículo{clientMode==="new"&&newName.trim()?` + cliente ${newName.trim()}`:""}
        </button>
      </div>
    </div>
  </div>);
}

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
  const cost = Number(mat.cost||0);
  const markup = mat.markup!=null ? Number(mat.markup) : 50;
  const salePrice = mat.fromStock ? cost : cost*(1+markup/100);
  const lineTotal = salePrice*qty;
  const freight = Number(mat.freight||0);
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
    {/* Cost + Markup for non-stock materials */}
    {showCost&&!mat.fromStock&&<>
      <span style={{display:"flex",alignItems:"center",gap:3,marginLeft:4,paddingLeft:6,borderLeft:`1px solid ${B.gray600}`}}>
        <span style={{fontSize:9,color:B.gray500}}>custo R$</span>
        <InlineEdit value={cost?fmtR2(cost):""} onSave={v=>onUpdate(idx,{...mat,cost:parseFloat(v.replace(",","."))||0})} placeholder="0" type="number"/>
      </span>
      <span style={{display:"flex",alignItems:"center",gap:3,marginLeft:2,paddingLeft:6,borderLeft:`1px solid ${B.gray600}`}}>
        <span style={{fontSize:9,color:B.gray500}}>mk</span>
        <InlineEdit value={String(markup)} onSave={v=>onUpdate(idx,{...mat,markup:Math.max(0,parseFloat(v)||0)})} placeholder="50" type="number"/>
        <span style={{fontSize:9,color:B.gray500}}>%</span>
      </span>
      {cost>0&&<span style={{fontSize:11,color:B.amber,fontWeight:700,marginLeft:2}}>={fmtBRL(salePrice)}</span>}
    </>}
    {showCost&&mat.fromStock&&<span style={{fontSize:11,color:B.purple,marginLeft:4,paddingLeft:6,borderLeft:`1px solid ${B.purple}44`}}>{fmtBRL(cost)}/un</span>}
    {showCost&&qty>1&&<span style={{fontSize:11,color:B.amber,fontWeight:700,marginLeft:4,paddingLeft:6,borderLeft:`1px solid ${B.amber}44`}}>{fmtBRL(lineTotal)}</span>}
    {/* Freight per material */}
    {showCost&&<span style={{display:"flex",alignItems:"center",gap:3,marginLeft:4,paddingLeft:6,borderLeft:`1px solid ${B.gray600}`,flexShrink:0}} title="Frete">
      <span style={{fontSize:9,color:B.gray500}}>🚚</span>
      <InlineEdit value={freight?fmtR2(freight):""} onSave={v=>onUpdate(idx,{...mat,freight:parseFloat(v.replace(",","."))||0})} placeholder="0" type="number"/>
    </span>}
    {showCost&&freight>0&&<span style={{fontSize:10,color:B.gray400,marginLeft:2}}>=frete</span>}
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
        <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
          <TaskLabel task={task} onUpdate={onUpdate}/>
          <CategoryPill category={task.category}/>
        </div>
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
          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
            <TaskLabel task={task} onUpdate={onUpdate}/>
            {task.outsourced&&<span style={{fontSize:10,fontWeight:700,color:"#a78bfa",background:"#a78bfa18",border:"1px solid #a78bfa44",borderRadius:5,padding:"1px 6px",flexShrink:0,whiteSpace:"nowrap"}}>Terceirizado</span>}
            <button onClick={()=>onUpdate(task.id,{outsourced:!task.outsourced})} title={task.outsourced?"Marcar como interno":"Marcar como terceirizado"}
              style={{background:task.outsourced?"#a78bfa22":"none",border:`1px solid ${task.outsourced?"#a78bfa44":B.gray600}`,borderRadius:5,padding:"1px 6px",cursor:"pointer",color:task.outsourced?"#a78bfa":B.gray500,fontSize:9,fontWeight:600,flexShrink:0}}>
              {task.outsourced?"✓ 3º":"3º"}
            </button>
            <CategorySelect value={task.category} onChange={cat=>onUpdate(task.id,{category:cat})}/>
          </div>
          {/* Per-task discount */}
          {c.laborGross>0&&<div style={{display:"flex",alignItems:"center",gap:5,marginTop:4}}>
            <span style={{fontSize:10,color:B.red,fontWeight:600,flexShrink:0}}>Desconto R$</span>
            <InlineEdit value={task.discount?fmtR2(task.discount):""} onSave={v=>onUpdate(task.id,{discount:Math.max(0,parseFloat(v.replace(",","."))||0)})} placeholder="0" type="number"/>
            {task.discount>0&&<>
              <span style={{fontSize:10,color:B.gray500,textDecoration:"line-through",flexShrink:0}}>{fmtBRL(c.laborGross)}</span>
              <span style={{fontSize:10,color:B.green,fontWeight:700,flexShrink:0}}>→ {fmtBRL(c.labor)}</span>
            </>}
          </div>}
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
function VehicleCard({vehicle,tasks,employees,clients,stock,defaultRate,managerMode,onAddTask,onToggleTask,onDeleteTask,onUpdateTask,onDeleteVehicle,onTransferMechanic,onTransferOwner,onUpdateVehicle,onConsumeStock,onReturnStock,hideManagerButtons=false,payments=[],onAddPayment,onDeletePayment,company,onAddMechanic,onRemoveMechanic,onSetStatus,onDeliver,isOwner=false}) {
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
  const [confirmDeliver,setConfirmDeliver]=useState(false);
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
            {(()=>{const p=PRIORITY[vehicle.priority||"medium"];return <span style={{background:p.bg,border:`1px solid ${p.border}`,borderRadius:5,padding:"0px 6px",color:p.color,fontWeight:700,fontSize:10}}>▲ {p.label}</span>;})()}
            {(vehicle.color||vehicle.year)&&<span style={{color:B.gray300}}>🎨{vehicle.color?` ${vehicle.color}`:""}{vehicle.year?` ${vehicle.year}`:""}</span>}
            {vehicle.notes&&<span style={{color:B.amber,fontSize:10,fontWeight:600}}>📝 Obs.</span>}
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
        {/* Priority button — always visible when managerMode */}
        {managerMode&&(()=>{
          const p=PRIORITY[vehicle.priority||"medium"];
          const cycle=()=>onUpdateVehicle(vehicle.id,{priority:p.next});
          return (<button onClick={cycle} title="Clique para alternar prioridade" style={{background:p.bg,border:`1px solid ${p.border}`,borderRadius:6,padding:"4px 9px",cursor:"pointer",color:p.color,display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,flex:"0 0 auto"}}>
            ▲ {p.label}
          </button>);
        })()}
        {/* Row 1 */}
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
          {vehicle.status==="ready"&&!vehicle.deliveredAt&&<button onClick={()=>onSetStatus(vehicle.id,"active")} style={{background:`${B.orange}22`,border:`1px solid ${B.orange}44`,borderRadius:6,padding:"4px 9px",cursor:"pointer",color:B.orange,display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,flex:"0 0 auto"}}>
            ↩ Reabrir
          </button>}
          {vehicle.status==="ready"&&!vehicle.deliveredAt&&isOwner&&onDeliver&&<button onClick={()=>setConfirmDeliver(true)} style={{background:`${B.green}22`,border:`1px solid ${B.green}44`,borderRadius:6,padding:"4px 9px",cursor:"pointer",color:B.green,display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:800,flex:"0 0 auto"}}>
            🚗 Entregar
          </button>}
          {vehicle.deliveredAt&&<span style={{fontSize:10,color:B.green,background:B.greenBg,border:`1px solid ${B.green}44`,borderRadius:6,padding:"3px 8px",flex:"0 0 auto",fontWeight:700}}>
            ✅ Entregue {new Date(vehicle.deliveredAt).toLocaleDateString("pt-BR")}
          </span>}
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

        {/* Mechanic chips with add/remove — manager only */}
        {managerMode&&<div style={{marginBottom:10}}>
          <div style={{fontSize:10,color:B.gray400,fontWeight:700,marginBottom:4,textTransform:"uppercase",letterSpacing:.5}}>🔧 Mecânicos</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
            {mechs.map(m=>(
              <div key={m.id} style={{display:"flex",alignItems:"center",gap:4,background:`${B.orange}18`,border:`1px solid ${B.orange}44`,borderRadius:6,padding:"3px 8px"}}>
                <IWrench s={10} c={B.orange}/>
                <span style={{fontSize:11,color:B.orange,fontWeight:600}}>{m.name}</span>
                {onRemoveMechanic&&mechs.length>1&&<button onClick={()=>onRemoveMechanic(vehicle.id,m.id)}
                  style={{background:"none",border:"none",cursor:"pointer",color:`${B.orange}88`,padding:0,display:"flex",marginLeft:2,lineHeight:1}}
                  title={`Remover ${m.name} deste veículo`}
                  onMouseEnter={e=>e.currentTarget.style.color=B.red}
                  onMouseLeave={e=>e.currentTarget.style.color=`${B.orange}88`}>
                  <IX s={10}/>
                </button>}
              </div>
            ))}
            {mechs.length===0&&<span style={{fontSize:11,color:B.gray500}}>Nenhum mecânico atribuído</span>}
          </div>
        </div>}

        {/* Notes — visible and editable by both mechanic and manager */}
        <div style={{marginBottom:10}}>
          <div style={{fontSize:10,color:B.gray400,fontWeight:700,marginBottom:4,textTransform:"uppercase",letterSpacing:.5}}>📝 Observações</div>
          <textarea
            defaultValue={vehicle.notes||""}
            key={vehicle.id}
            onBlur={e=>{if(e.target.value!==(vehicle.notes||""))onUpdateVehicle(vehicle.id,{notes:e.target.value});}}
            placeholder="Observações sobre o veículo ou a OS... (visível para mecânicos e gestores)"
            rows={3}
            style={{width:"100%",padding:"8px 10px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:12.5,outline:"none",resize:"vertical",boxSizing:"border-box",fontFamily:"inherit",lineHeight:1.5}}
          />
        </div>
        {/* Vehicle data — inline editable (manager only) */}
        {managerMode&&<div style={{marginBottom:10,padding:"8px 12px",background:B.gray900,border:`1px solid ${B.gray700}`,borderRadius:8}}>
          <div style={{fontSize:10,color:B.gray400,fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>🚗 Dados do veículo</div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <div style={{flex:"2 1 150px"}}>
              <div style={{fontSize:9,color:B.gray500,marginBottom:2}}>Modelo</div>
              <InlineEdit value={vehicle.model} onSave={v=>v.trim()&&onUpdateVehicle(vehicle.id,{model:v.trim()})} placeholder="Modelo"/>
            </div>
            <div style={{flex:"1 1 90px"}}>
              <div style={{fontSize:9,color:B.gray500,marginBottom:2}}>Placa</div>
              <InlineEdit value={vehicle.plate} onSave={v=>v.trim()&&onUpdateVehicle(vehicle.id,{plate:v.trim().toUpperCase()})} placeholder="Placa"/>
            </div>
            <div style={{flex:"1 1 60px"}}>
              <div style={{fontSize:9,color:B.gray500,marginBottom:2}}>Ano</div>
              <InlineEdit value={vehicle.year?String(vehicle.year):""} onSave={v=>onUpdateVehicle(vehicle.id,{year:parseInt(v)||null})} placeholder="----" type="number"/>
            </div>
            <div style={{flex:"1 1 100px"}}>
              <div style={{fontSize:9,color:B.gray500,marginBottom:2}}>Cor</div>
              <InlineEdit value={vehicle.color||""} onSave={v=>onUpdateVehicle(vehicle.id,{color:v})} placeholder="—"/>
            </div>
          </div>
        </div>}
        {(()=>{
          // Group tasks by category; uncategorized → null group rendered last
          const groups=[];
          const seen=new Set();
          // First pass: preserve order of first appearance per category
          const catOrder=[];
          vts.forEach(t=>{
            const cat=t.category||null;
            const key=cat||"__none__";
            if(!seen.has(key)){seen.add(key);catOrder.push(cat);}
          });
          return catOrder.map(cat=>{
            const groupTasks=vts.filter(t=>(t.category||null)===cat);
            const catColor=cat?CAT_MAP[cat]||B.gray500:null;
            return (<div key={cat||"__none__"} style={{marginBottom:4}}>
              {cat&&<div style={{display:"flex",alignItems:"center",gap:6,margin:"8px 0 4px",padding:"3px 8px",background:catColor+"15",borderLeft:`3px solid ${catColor}`,borderRadius:"0 4px 4px 0"}}>
                <span style={{width:7,height:7,borderRadius:99,background:catColor,flexShrink:0}}/>
                <span style={{fontSize:10,fontWeight:800,color:catColor,textTransform:"uppercase",letterSpacing:.8}}>{cat}</span>
                <span style={{fontSize:10,color:catColor+"99",marginLeft:"auto"}}>{groupTasks.length} tarefa{groupTasks.length!==1?"s":""}</span>
              </div>}
              {groupTasks.map(t=>managerMode
                ?<TaskItemManager key={t.id} task={t} defaultRate={defaultRate} stock={stock} employees={employees} onToggle={onToggleTask} onDelete={onDeleteTask} onUpdate={onUpdateTask} onConsumeStock={onConsumeStock} onReturnStock={onReturnStock}/>
                :<TaskItemMechanic key={t.id} task={t} employees={employees} onToggle={onToggleTask} onDelete={onDeleteTask} onUpdate={onUpdateTask}/>
              )}
            </div>);
          });
        })()}
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
        {managerMode&&<div style={{marginTop:10,padding:"10px 12px",background:B.gray900,border:`1px solid ${B.gray700}`,borderRadius:8,display:"flex",flexDirection:"column",gap:8}}>
          {/* Fuel */}
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{fontSize:13}}>⛽</span>
            <span style={{fontSize:12,color:B.gray400,fontWeight:600}}>Combustível:</span>
            <span style={{display:"flex",alignItems:"center",gap:3}}>
              <span style={{fontSize:11,color:B.amber}}>R$</span>
              <InlineEdit value={vehicle.fuelCost?fmtR2(vehicle.fuelCost):""} onSave={v=>{const val=parseFloat(v.replace(",","."))||0;onUpdateVehicle(vehicle.id,{fuelCost:val});}} placeholder="0" type="number"/>
            </span>
            {vehicle.fuelCost>0&&<span style={{fontSize:11,color:B.amber,fontWeight:700}}>{fmtBRL(vehicle.fuelCost)}</span>}
          </div>
          {/* OS-level % discount on labor */}
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",paddingTop:8,borderTop:`1px solid ${B.gray700}`}}>
            <span style={{fontSize:13}}>🏷️</span>
            <span style={{fontSize:12,color:B.red,fontWeight:600}}>Desconto geral (% sobre mão de obra):</span>
            <span style={{display:"flex",alignItems:"center",gap:3}}>
              <InlineEdit value={vehicle.osDiscountPct?fmtR2(vehicle.osDiscountPct):""} onSave={v=>{const val=Math.max(0,Math.min(100,parseFloat(v.replace(",","."))||0));onUpdateVehicle(vehicle.id,{osDiscountPct:val});}} placeholder="0" type="number"/>
              <span style={{fontSize:11,color:B.gray400}}>%</span>
            </span>
            {vehicle.osDiscountPct>0&&(()=>{
              const laborSum=vts.reduce((s,t)=>s+taskCost(t,defaultRate).labor,0);
              const discAmt=laborSum*Number(vehicle.osDiscountPct)/100;
              return <span style={{fontSize:11,color:B.red,fontWeight:700}}>= -{fmtBRL(discAmt)} s/ mão de obra</span>;
            })()}
          </div>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
              <span style={{fontSize:13}}>🚛</span>
              <span style={{fontSize:12,color:B.gray400,fontWeight:600}}>Reboque</span>
              <button onClick={()=>{const tows=[...(vehicle.tows||[]),{origin:"",destination:"",value:0}];onUpdateVehicle(vehicle.id,{tows});}}
                style={{marginLeft:"auto",background:`${B.blue}22`,border:`1px solid ${B.blue}44`,borderRadius:6,padding:"2px 8px",cursor:"pointer",color:B.blue,fontSize:11,fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
                <IPlus s={11} c={B.blue}/>Adicionar reboque
              </button>
            </div>
            {(vehicle.tows||[]).map((tow,ti)=>(
              <div key={ti} style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",background:B.gray800,border:`1px solid ${B.gray700}`,borderRadius:7,padding:"7px 10px",marginBottom:5}}>
                <span style={{fontSize:10,color:B.gray500,fontWeight:700,flexShrink:0}}>#{ti+1}</span>
                <span style={{fontSize:10,color:B.gray500,flexShrink:0}}>Origem:</span>
                <InlineEdit value={tow.origin||""} onSave={v=>{const tows=[...(vehicle.tows||[])];tows[ti]={...tows[ti],origin:v};onUpdateVehicle(vehicle.id,{tows});}} placeholder="Cidade de origem"/>
                <span style={{fontSize:10,color:B.gray500,flexShrink:0}}>→ Destino:</span>
                <InlineEdit value={tow.destination||""} onSave={v=>{const tows=[...(vehicle.tows||[])];tows[ti]={...tows[ti],destination:v};onUpdateVehicle(vehicle.id,{tows});}} placeholder="Cidade destino"/>
                <span style={{fontSize:10,color:B.gray500,flexShrink:0}}>R$</span>
                <InlineEdit value={tow.value?fmtR2(tow.value):""} onSave={v=>{const tows=[...(vehicle.tows||[])];tows[ti]={...tows[ti],value:parseFloat(v.replace(",","."))||0};onUpdateVehicle(vehicle.id,{tows});}} placeholder="0" type="number"/>
                {tow.value>0&&<span style={{fontSize:11,color:B.blue,fontWeight:700}}>{fmtBRL(tow.value)}</span>}
                <button onClick={()=>{const tows=(vehicle.tows||[]).filter((_,i)=>i!==ti);onUpdateVehicle(vehicle.id,{tows});}}
                  style={{background:"none",border:"none",cursor:"pointer",color:B.gray500,padding:0,display:"flex",marginLeft:"auto"}}
                  onMouseEnter={e=>e.currentTarget.style.color=B.red} onMouseLeave={e=>e.currentTarget.style.color=B.gray500}><IX s={12}/></button>
              </div>
            ))}
          </div>
        </div>}
        {(()=>{
          const towTotal=(vehicle.tows||[]).reduce((s,t)=>s+Number(t.value||0),0);
          const laborSum=vts.reduce((s,t)=>s+taskCost(t,defaultRate).labor,0);
          const osDiscountAmt=laborSum*Number(vehicle.osDiscountPct||0)/100;
          const grandTotal=total+Number(vehicle.fuelCost||0)+towTotal-osDiscountAmt;
          if(!managerMode||grandTotal<=0) return null;
          const breakdown=[];
          if(total>0) breakdown.push(`Serviços: ${fmtBRL(total)}`);
          if(osDiscountAmt>0) breakdown.push(`Desconto: -${fmtBRL(osDiscountAmt)}`);
          if(vehicle.fuelCost>0) breakdown.push(`Combustível: ${fmtBRL(vehicle.fuelCost)}`);
          if(towTotal>0) breakdown.push(`Reboque: ${fmtBRL(towTotal)}`);
          return (<div style={{marginTop:8,padding:"8px 12px",background:B.amberBg,border:`1px solid ${B.amber}44`,borderRadius:8}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:12,color:B.gray400}}>Total deste veículo</span>
              <span style={{fontSize:15,fontWeight:800,color:B.amber}}>{fmtBRL(grandTotal)}</span>
            </div>
            {breakdown.length>1&&<div style={{fontSize:11,color:B.gray500,marginTop:2}}>{breakdown.join(" · ")}</div>}
          </div>);
        })()}
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
    {confirmDeliver&&<ConfirmModal title="Confirmar entrega?" danger={false} message={<>Registrar a entrega de <b style={{color:B.white}}>{vehicle.model} — {vehicle.plate}</b> ao cliente? O timer será encerrado. Esta ação pode ser revertida pelo botão Reabrir.</>} confirmLabel="Confirmar entrega" onConfirm={()=>{onDeliver(vehicle.id);setConfirmDeliver(false);}} onCancel={()=>setConfirmDeliver(false)}/>}
  </>);
}

// ─── EmployeeCard ─────────────────────────────────────────────────────────────
function EmployeeCard({employee,vehicles,tasks,employees,clients,stock,defaultRate,onAddVehicle,onDeleteVehicle,onTransferMechanic,onTransferOwner,onAddTask,onToggleTask,onDeleteTask,onUpdateTask,onUpdateVehicle,onConsumeStock,onReturnStock,onDelete,onSendWA,onUpdatePhone,onUpdateName,onAddMechanic,onRemoveMechanic,onSetStatus,onDeliver,isOwner=false}) {
  const [open,setOpen]=useState(false);
  const [showF,setSF]=useState(false);
  const [showPicker,setShowPicker]=useState(false);
  const [confirmDel,setConfirmDel]=useState(false);
  const [model,setMod]=useState(""); const [plate,setPlate]=useState(""); const [vColor,setVColor]=useState("");
  const empV=[...vehicles.filter(v=>(v.mechanicIds||[v.employeeId]).includes(employee.id) && v.status!=="ready")]
    .sort((a,b)=>{
    const pri={high:0,medium:1,low:2};
    const pA=pri[a.priority||"medium"], pB=pri[b.priority||"medium"];
    if(pA!==pB) return pA-pB;
    return (a.status==="paused"?1:0)-(b.status==="paused"?1:0);
  });
  const totT=tasks.filter(t=>empV.find(v=>v.id===t.vehicleId)).length;
  const donT=tasks.filter(t=>empV.find(v=>v.id===t.vehicleId)&&t.done).length;
  const addV=()=>{if(!model.trim()||!plate.trim())return;onAddVehicle(employee.id,model.trim(),plate.trim().toUpperCase(),vColor.trim());setMod("");setPlate("");setVColor("");setSF(false);};;
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
        onAddMechanic={onAddMechanic} onRemoveMechanic={onRemoveMechanic} onSetStatus={onSetStatus} onDeliver={onDeliver} isOwner={isOwner}/>)}
      {showF?<div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:4}}>
        <input value={model} onChange={e=>setMod(e.target.value)} placeholder="Modelo (ex: Honda Civic 2020)"
          style={{flex:"1 1 160px",padding:"7px 12px",borderRadius:7,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none"}}/>
        <input value={plate} onChange={e=>setPlate(e.target.value)} placeholder="Placa"
          style={{flex:"0 1 110px",padding:"7px 12px",borderRadius:7,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none",fontFamily:"monospace",letterSpacing:1}}/>
        <input value={vColor} onChange={e=>setVColor(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addV()} placeholder="Cor (ex: Preto)"
          style={{flex:"0 1 120px",padding:"7px 12px",borderRadius:7,border:`1px solid ${B.gray600}`,background:B.gray900,color:B.white,fontSize:13,outline:"none"}}/>
        <button onClick={addV} style={{padding:"7px 14px",borderRadius:7,background:B.orange,border:"none",color:B.white,cursor:"pointer",fontWeight:700}}>Salvar</button>
        <button onClick={()=>setSF(false)} style={{padding:"7px 10px",borderRadius:7,background:B.gray700,border:"none",color:B.gray200,cursor:"pointer"}}>✕</button>
      </div>:<button onClick={()=>setShowPicker(true)} style={{marginTop:4,padding:"7px 12px",borderRadius:8,background:"transparent",border:`1px dashed ${B.orange}66`,color:B.orange,cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontWeight:600,fontSize:13}}
        onMouseEnter={e=>e.currentTarget.style.background=`${B.orange}15`} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
        <ICar s={13} c={B.orange}/>+ Veículo
      </button>}
      {showPicker&&<VehiclePickerModal
        vehicles={vehicles}
        employees={employees}
        clients={clients}
        employeeId={employee.id}
        onPickExisting={vid=>{onAddMechanic&&onAddMechanic(vid,employee.id);setShowPicker(false);}}
        onCreateNew={()=>{setShowPicker(false);setSF(true);}}
        onClose={()=>setShowPicker(false)}/>}
    </div>}
  </div>
  {confirmDel&&<ConfirmModal title="Remover mecânico?" message={<>Tem certeza que deseja remover <b style={{color:B.white}}>{employee.name}</b>? Todos os veículos e tarefas associados também serão removidos.</>} confirmLabel="Remover mecânico" onConfirm={()=>{onDelete(employee.id);setConfirmDel(false);}} onCancel={()=>setConfirmDel(false)}/>}
  </>);
}

// ─── ClientCard ───────────────────────────────────────────────────────────────
function ClientCard({client,vehicles,tasks,employees,clients,stock,defaultRate,onUpdatePhone,onUpdateName,onUpdateEmail,onDelete,onSendWA,onTransferMechanic,onTransferOwner,onToggleTask,onDeleteTask,onAddTask,onUpdateTask,onUpdateVehicle,onDeleteVehicle,onConsumeStock,onReturnStock,payments=[],onAddPayment,onDeletePayment,company,onAddMechanic,onRemoveMechanic,onSetStatus,onDeliver,isOwner=false}) {
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
          onAddMechanic={onAddMechanic} onRemoveMechanic={onRemoveMechanic} onSetStatus={onSetStatus} onDeliver={onDeliver} isOwner={isOwner}/>)}
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
        Custo inicial: <b style={{color:B.white}}>{fmtBRL(form.costPrice||0)}</b> + markup {form.markup||0}% → Preço de venda: <b style={{color:B.amber}}>{fmtBRL(Number(form.costPrice||0)*(1+Number(form.markup||0)/100))}</b> · O custo será recalculado automaticamente ao lançar compras.
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
            <div style={{fontSize:11.5,color:B.gray500}}>O custo unitário é atualizado automaticamente como a <b style={{color:B.gray300}}>média ponderada</b> das compras registradas. O preço de venda = custo médio × (1 + markup%).</div>
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

// ─── OS Grouped View — vehicles grouped by mechanic ──────────────────────────
function OsGroupedView({groups,sortVehicles,tasks,employees,clients,stock,defaultRate,company,
  addTask,toggleT,delTask,updTask,updVeh,delVeh,xferMech,xferOwn,consumeStock,returnStock,
  payments,addPayment,deletePayment,addVehicleMechanic,removeVehicleMechanic,setVehicleStatus,deliverVehicle,adminRole}) {
  const [collapsed,setCollapsed]=useState({});
  const toggle=key=>setCollapsed(p=>({...p,[key]:!p[key]}));
  return (<div style={{display:"flex",flexDirection:"column",gap:16}}>
    {groups.map(({emp,vehicles:gVs})=>{
      const key=emp?.id||"__none__";
      const sorted=sortVehicles(gVs);
      const isCollapsed=!!collapsed[key];
      const doneTasks=tasks.filter(t=>gVs.find(v=>v.id===t.vehicleId)&&t.done).length;
      const totalTasks=tasks.filter(t=>gVs.find(v=>v.id===t.vehicleId)).length;
      return (<div key={key} style={{background:B.gray800,borderRadius:14,border:`1px solid ${B.gray700}`,overflow:"hidden"}}>
        {/* Section header */}
        <div onClick={()=>toggle(key)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",cursor:"pointer",background:B.gray900,userSelect:"none"}}>
          <div style={{width:36,height:36,borderRadius:9,background:emp?`${B.orange}22`:B.gray700,border:`1px solid ${emp?B.orange+"44":B.gray600}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <IWrench s={17} c={emp?B.orange:B.gray500}/>
          </div>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,fontSize:14,color:emp?B.white:B.gray400}}>{emp?emp.name:"Sem mecânico atribuído"}</div>
            <div style={{fontSize:11,color:B.gray400,marginTop:1}}>{gVs.length} veículo{gVs.length!==1?"s":""} · {doneTasks}/{totalTasks} tarefas</div>
          </div>
          {/* Priority summary badges */}
          <div style={{display:"flex",gap:4,flexShrink:0}}>
            {["high","medium","low"].map(p=>{
              const count=gVs.filter(v=>(v.priority||"medium")===p).length;
              if(!count) return null;
              const cfg=PRIORITY[p];
              return <span key={p} style={{fontSize:10,fontWeight:700,color:cfg.color,background:cfg.bg,border:`1px solid ${cfg.border}`,borderRadius:5,padding:"1px 6px"}}>{count}</span>;
            })}
          </div>
          <div style={{color:B.gray400,flexShrink:0}}>{isCollapsed?<IChevD s={15}/>:<IChevU s={15}/>}</div>
        </div>
        {/* Vehicles */}
        {!isCollapsed&&<div style={{padding:"10px 12px",display:"flex",flexDirection:"column",gap:8}}>
          {sorted.map(v=><VehicleCard key={v.id} vehicle={v} tasks={tasks} employees={employees} clients={clients} stock={stock} defaultRate={defaultRate} managerMode={true}
            onAddTask={addTask} onToggleTask={toggleT} onDeleteTask={delTask} onUpdateTask={updTask} onUpdateVehicle={updVeh} onDeleteVehicle={delVeh}
            onTransferMechanic={xferMech} onTransferOwner={xferOwn}
            onConsumeStock={consumeStock} onReturnStock={returnStock}
            payments={payments} onAddPayment={addPayment} onDeletePayment={deletePayment} company={company}
            onAddMechanic={addVehicleMechanic} onRemoveMechanic={removeVehicleMechanic} onSetStatus={setVehicleStatus} onDeliver={deliverVehicle} isOwner={adminRole==="owner"}/>)}
        </div>}
      </div>);
    })}
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
function VehiclesTab({vehicles,tasks,employees,clients,defaultRate,onUpdateVehicle,osHistory=[],onOpenOS,company,onCreateVehicle}) {
  const [search,setSearch]=useState("");
  const [now,setNow]=useState(Date.now());
  const [showCreate,setShowCreate]=useState(false);

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

  const sorted=[...filtered].sort((a,b)=>{
    if(a.enteredAt && b.enteredAt) return new Date(a.enteredAt)-new Date(b.enteredAt);
    if(a.enteredAt) return -1;
    if(b.enteredAt) return 1;
    return 0;
  });

  return (<div>
    {/* Search bar + new vehicle button */}
    <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center"}}>
      <div style={{position:"relative",flex:1,maxWidth:340}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por modelo, placa ou cliente…"
          style={{width:"100%",padding:"8px 12px 8px 32px",borderRadius:8,border:`1px solid ${B.gray600}`,background:B.gray800,color:B.white,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
        <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:B.gray400}}><ISearch s={14}/></span>
        {search&&<button onClick={()=>setSearch("")} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:B.gray400}}><IX s={13}/></button>}
      </div>
      <button onClick={()=>setShowCreate(true)} style={{padding:"8px 14px",borderRadius:8,background:`${B.orange}22`,border:`1px solid ${B.orange}44`,color:B.orange,cursor:"pointer",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
        <IPlus s={14} c={B.orange}/>Novo veículo
      </button>
      <div style={{fontSize:11,color:B.gray400,flexShrink:0}}>{sorted.length} veículo{sorted.length!==1?"s":""}</div>
    </div>

    {showCreate&&<CreateVehicleModal clients={clients} onConfirm={(data)=>{onCreateVehicle&&onCreateVehicle(data);setShowCreate(false);}} onClose={()=>setShowCreate(false)}/>}

    {sorted.length===0?
      <div style={{textAlign:"center",padding:"56px 0",color:B.gray400}}>
        <div style={{fontSize:40,marginBottom:12}}>🚗</div>
        <div style={{fontWeight:700,color:B.gray200,marginBottom:4}}>{search?"Nenhum veículo encontrado":"Nenhum veículo cadastrado"}</div>
        <div style={{fontSize:13}}>Clique em <b style={{color:B.orange}}>+ Novo veículo</b> para cadastrar o primeiro.</div>
      </div>
    :<div style={{display:"flex",flexDirection:"column",gap:10}}>
      {sorted.map(v=><VehicleHistoryCard key={v.id} vehicle={v} tasks={tasks} employees={employees} clients={clients} defaultRate={defaultRate} onUpdateVehicle={onUpdateVehicle} now={now} osHistory={osHistory.filter(h=>h.vehicle_id===v.id)} onOpenOS={onOpenOS} company={company}/>)}
    </div>}
  </div>);
}

function VehicleHistoryCard({vehicle,tasks,employees,clients,defaultRate,onUpdateVehicle,now,osHistory=[],onOpenOS,company}) {
  const [open,setOpen]=useState(false);
  const [showHistory,setShowHistory]=useState(false);
  const [showOpenOS,setShowOpenOS]=useState(false);
  const [editEntry,setEditEntry]=useState(false);
  const [pdfLoading,setPdfLoading]=useState(null); // holds history record id while loading
  const [entryInput,setEntryInput]=useState(vehicle.enteredAt?new Date(vehicle.enteredAt).toISOString().slice(0,16):"");

  const vts    = tasks.filter(t=>t.vehicleId===vehicle.id);
  const done   = vts.filter(t=>t.done);
  const pending= vts.filter(t=>!t.done);
  const cli    = clients.find(c=>c.id===vehicle.clientId);
  const hasActiveOS = !!vehicle.enteredAt || vts.length>0;

  // Timer: if delivered but not yet reset (deliveredAt set, enteredAt still set), freeze at deliveredAt
  const timerEndMs = vehicle.deliveredAt ? new Date(vehicle.deliveredAt).getTime() : now;
  const elapsed = vehicle.enteredAt ? elapsedTime(vehicle.enteredAt, timerEndMs) : null;

  const total   = vts.reduce((s,t)=>s+taskCost(t,defaultRate).total,0);
  const doneCost= done.reduce((s,t)=>s+taskCost(t,defaultRate).total,0);

  const saveEntry=()=>{
    const val=entryInput?new Date(entryInput).toISOString():null;
    onUpdateVehicle(vehicle.id,{enteredAt:val});
    setEditEntry(false);
  };
  const clearEntry=()=>{ onUpdateVehicle(vehicle.id,{enteredAt:null}); setEntryInput(""); setEditEntry(false); };

  // Sort osHistory newest first
  const sortedHistory=[...osHistory].sort((a,b)=>new Date(b.delivered_at||0)-new Date(a.delivered_at||0));

  return (<div style={{background:B.gray800,borderRadius:12,border:`1px solid ${B.gray700}`,overflow:"hidden"}}>
    {/* Header row */}
    <div className="osc-vhc-header" style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",cursor:"pointer",background:B.gray900}} onClick={()=>setOpen(o=>!o)}>
      <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
        {vehicle.photo
          ?<img src={vehicle.photo} alt="" style={{width:42,height:42,borderRadius:8,objectFit:"cover",flexShrink:0,border:`1px solid ${B.gray700}`}}/>
          :<div style={{width:42,height:42,borderRadius:8,background:`${B.orange}22`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><ICar s={19} c={B.orange}/></div>}

        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:700,fontSize:13.5,color:B.white,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{vehicle.model}</div>
          <div style={{fontSize:11,color:B.gray400,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginTop:1}}>
            <span style={{fontFamily:"monospace",letterSpacing:.5}}>{vehicle.plate}</span>
            {vehicle.year&&<span style={{color:B.gray400}}>{vehicle.year}</span>}
            {(vehicle.color||vehicle.year)&&vehicle.color&&<span style={{color:B.gray300}}>🎨 {vehicle.color}</span>}
            {vehicle.osNumber&&<span style={{background:`${B.orange}22`,color:B.orange,borderRadius:5,padding:"0px 6px",fontWeight:700,fontSize:10}}>{fmtOS(vehicle.osNumber)}</span>}
            {cli&&<span style={{color:B.blue}}>👤 {cli.name}</span>}
            {!hasActiveOS&&sortedHistory.length>0&&<span style={{color:B.gray500,fontSize:10}}>📋 {sortedHistory.length} OS anterior{sortedHistory.length!==1?"es":""}</span>}
          </div>
          {vts.length>0&&<ProgressBar value={done.length} max={vts.length}/>}
        </div>
      </div>

      {/* Timer badge — stacks below on mobile */}
      <div className="osc-vhc-timer" style={{flexShrink:0,textAlign:"right",marginRight:4}}>
        {elapsed&&vehicle.deliveredAt
          ?<div style={{background:`${B.green}18`,border:`1px solid ${B.green}44`,borderRadius:8,padding:"4px 10px",display:"flex",alignItems:"center",gap:6}}>
              <div style={{fontSize:9,color:B.green,fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>✅ Entregue</div>
              <div style={{fontSize:12,fontWeight:800,color:B.green}}>{elapsed.label}</div>
            </div>
          :elapsed
            ?<div style={{background:`${elapsed.color}18`,border:`1px solid ${elapsed.color}44`,borderRadius:8,padding:"4px 10px",display:"flex",alignItems:"center",gap:6}}>
                <div style={{fontSize:9,color:elapsed.color,fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>⏱ Na oficina</div>
                <div style={{fontSize:13,fontWeight:800,color:elapsed.color}}>{elapsed.label}</div>
              </div>
            :!hasActiveOS&&<div style={{background:B.greenBg,border:`1px solid ${B.green}44`,borderRadius:8,padding:"4px 10px",display:"flex",alignItems:"center",gap:6}}>
                <div style={{fontSize:9,color:B.green,fontWeight:700}}>Disponível</div>
                <div style={{fontSize:10,color:B.gray400}}>Sem OS ativa</div>
              </div>}
        {!elapsed&&hasActiveOS&&<button onClick={e=>{e.stopPropagation();setEditEntry(true);}} style={{background:B.gray700,border:`1px dashed ${B.gray600}`,borderRadius:8,padding:"4px 10px",cursor:"pointer",color:B.gray400,fontSize:11,fontWeight:600}}>
          + Registrar entrada
        </button>}
      </div>

      {/* Task summary */}
      {vts.length>0&&<div className="osc-vhc-summary" style={{flexShrink:0,textAlign:"right",marginRight:4}}>
        <div style={{fontSize:10,color:B.gray400}}>Serviços</div>
        <div style={{fontSize:12,fontWeight:700,color:B.white}}>{done.length}/{vts.length}</div>
        {total>0&&<div style={{fontSize:11,fontWeight:800,color:B.amber}}>{fmtBRL(total)}</div>}
      </div>}

      <div style={{color:B.gray400,flexShrink:0}}>{open?<IChevU s={15}/>:<IChevD s={15}/>}</div>
    </div>

    {/* Expanded content */}
    {open&&<div style={{padding:"14px 16px"}}>

      {/* Vehicle data — inline editable — always visible */}
      <div style={{marginBottom:14,padding:"8px 12px",background:B.gray900,border:`1px solid ${B.gray700}`,borderRadius:8}}>
        <div style={{fontSize:10,color:B.gray400,fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>🚗 Dados do veículo</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <div style={{flex:"2 1 150px"}}>
            <div style={{fontSize:9,color:B.gray500,marginBottom:2}}>Modelo</div>
            <InlineEdit value={vehicle.model} onSave={v=>v.trim()&&onUpdateVehicle(vehicle.id,{model:v.trim()})} placeholder="Modelo"/>
          </div>
          <div style={{flex:"1 1 90px"}}>
            <div style={{fontSize:9,color:B.gray500,marginBottom:2}}>Placa</div>
            <InlineEdit value={vehicle.plate} onSave={v=>v.trim()&&onUpdateVehicle(vehicle.id,{plate:v.trim().toUpperCase()})} placeholder="Placa"/>
          </div>
          <div style={{flex:"1 1 60px"}}>
            <div style={{fontSize:9,color:B.gray500,marginBottom:2}}>Ano</div>
            <InlineEdit value={vehicle.year?String(vehicle.year):""} onSave={v=>onUpdateVehicle(vehicle.id,{year:parseInt(v)||null})} placeholder="----" type="number"/>
          </div>
          <div style={{flex:"1 1 100px"}}>
            <div style={{fontSize:9,color:B.gray500,marginBottom:2}}>Cor</div>
            <InlineEdit value={vehicle.color||""} onSave={v=>onUpdateVehicle(vehicle.id,{color:v})} placeholder="—"/>
          </div>
        </div>
      </div>

      {/* ── Active OS ── */}
      {hasActiveOS&&<>

        {/* Entry time */}
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

        {/* Completed services */}
        {done.length>0&&<>
          <div style={{fontSize:10,color:B.green,fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>✅ Concluídos ({done.length})</div>
          <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:8}}>
            {done.map(t=>{
              const tc=taskCost(t,defaultRate);
              return (<div key={t.id} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"7px 10px",background:B.greenBg,border:`1px solid ${B.green}33`,borderRadius:7}}>
                <ICheck s={13} c={B.green}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12.5,color:B.gray200,fontWeight:600}}>{t.label}</div>
                  {(t.materials||[]).length>0&&<div style={{fontSize:11,color:B.gray400,marginTop:2}}>
                    {t.materials.map((m,i)=><span key={i} style={{marginRight:8}}>🔩 {m.name}{(m.qty||1)>1?` ×${m.qty}`:""}</span>)}
                  </div>}
                </div>
                {tc.total>0&&<span style={{fontSize:11,fontWeight:700,color:B.green,flexShrink:0}}>{fmtBRL(tc.total)}</span>}
              </div>);
            })}
          </div>
          {doneCost>0&&<div style={{marginBottom:12,padding:"7px 12px",background:B.amberBg,border:`1px solid ${B.amber}44`,borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:12,color:B.gray400}}>Total OS atual</span>
            <span style={{fontSize:14,fontWeight:800,color:B.amber}}>{fmtBRL(doneCost)}</span>
          </div>}
        </>}

        {vts.length===0&&<div style={{textAlign:"center",padding:"12px 0",color:B.gray400,fontSize:13}}>Nenhum serviço registrado nesta OS ainda.</div>}
      </>}

      {/* No active OS */}
      {!hasActiveOS&&<div style={{textAlign:"center",padding:"16px 0",color:B.gray400}}>
        <div style={{fontSize:22,marginBottom:4}}>✅</div>
        <div style={{fontWeight:600,color:B.gray200,fontSize:13}}>Veículo disponível para nova OS</div>
        <div style={{fontSize:12,color:B.gray500,marginTop:2,marginBottom:10}}>Nenhuma OS em andamento neste momento</div>
        {onOpenOS&&<button onClick={()=>setShowOpenOS(true)} style={{padding:"8px 20px",borderRadius:9,background:B.greenBg,border:`1px solid ${B.green}44`,color:B.green,cursor:"pointer",fontWeight:700,fontSize:13,display:"inline-flex",alignItems:"center",gap:6}}>
          <IPlus s={14} c={B.green}/>Abrir nova OS
        </button>}
      </div>}

      {showOpenOS&&<OpenOSModal vehicle={vehicle} employees={employees} onConfirm={(empId,entryStr)=>{onOpenOS(vehicle.id,empId,entryStr);setShowOpenOS(false);}} onClose={()=>setShowOpenOS(false)}/>}

      {/* ── OS History ── */}
      {sortedHistory.length>0&&<div style={{marginTop:16,paddingTop:14,borderTop:`1px solid ${B.gray700}`}}>
        <button onClick={()=>setShowHistory(p=>!p)} style={{display:"flex",alignItems:"center",gap:8,background:"none",border:"none",cursor:"pointer",padding:0,marginBottom:showHistory?10:0,width:"100%"}}>
          <div style={{fontSize:10,color:B.purple,fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>📋 Histórico de OSs ({sortedHistory.length})</div>
          <div style={{color:B.gray400,marginLeft:"auto"}}>{showHistory?<IChevU s={13}/>:<IChevD s={13}/>}</div>
        </button>
        {showHistory&&<div style={{display:"flex",flexDirection:"column",gap:8}}>
          {sortedHistory.map(h=>{
            const hTasks=Array.isArray(h.tasks_snapshot)?h.tasks_snapshot:(h.tasksSnapshot||[]);
            const hMechs=(h.mechanic_ids||h.mechanicIds||[]).map(id=>employees.find(e=>e.id===id)?.name).filter(Boolean);
            const hClient=clients.find(c=>c.id===(h.client_id||h.clientId));
            const enteredMs=h.entered_at?new Date(h.entered_at).getTime():null;
            const deliveredMs=h.delivered_at?new Date(h.delivered_at).getTime():null;
            const totalMs=enteredMs&&deliveredMs?(deliveredMs-enteredMs):null;
            const pausedMs=Number(h.total_paused_ms||0);
            const workMs=totalMs?Math.max(0,totalMs-pausedMs):null;
            const fmtMs=ms=>{
              if(!ms) return null;
              const h=Math.floor(ms/3600000), m=Math.floor((ms%3600000)/60000);
              return h>24?`${Math.floor(h/24)}d ${h%24}h`:`${h}h ${m}m`;
            };
            return (<div key={h.id} style={{background:B.gray700,borderRadius:9,padding:"10px 12px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:6}}>
                <span style={{background:`${B.orange}22`,color:B.orange,borderRadius:5,padding:"0px 7px",fontWeight:800,fontSize:11}}>{h.os_number?fmtOS(h.os_number):"OS-?"}</span>
                {hClient&&<span style={{fontSize:11,color:B.blue}}>👤 {hClient.name}</span>}
                {hMechs.length>0&&<span style={{fontSize:11,color:B.orange}}>🔧 {hMechs.join(", ")}</span>}
                {h.total_value>0&&<span style={{fontSize:12,fontWeight:800,color:B.amber,marginLeft:"auto"}}>{fmtBRL(h.total_value)}</span>}
                <button disabled={pdfLoading===h.id} onClick={async()=>{
                  setPdfLoading(h.id);
                  try{
                    const histVehicle={...vehicle,osNumber:h.os_number,plate:vehicle.plate,model:vehicle.model,fuelCost:h.fuel_cost||0,tows:h.tows||[],osDiscountPct:h.os_discount_pct||0};
                    const hEmployee=employees.find(e=>(h.mechanic_ids||[]).includes(e.id))||null;
                    await generateQuotePDF(histVehicle,[],hClient,hEmployee,company,defaultRate,hTasks);
                  }catch(err){alert("Erro ao gerar PDF: "+err.message);}
                  setPdfLoading(null);
                }} style={{background:pdfLoading===h.id?B.gray600:`${B.amber}22`,border:`1px solid ${B.amber}44`,borderRadius:6,padding:"3px 9px",cursor:pdfLoading===h.id?"wait":"pointer",color:pdfLoading===h.id?B.gray400:B.amber,fontSize:11,fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
                  <IFileText s={11} c={pdfLoading===h.id?B.gray400:B.amber}/>{pdfLoading===h.id?"PDF…":"PDF"}
                </button>
              </div>
              <div style={{fontSize:11,color:B.gray400,display:"flex",gap:12,flexWrap:"wrap",marginBottom:hTasks.length?6:0}}>
                {h.entered_at&&<span>📅 Entrada: {new Date(h.entered_at).toLocaleDateString("pt-BR")}</span>}
                {h.delivered_at&&<span>✅ Entrega: {new Date(h.delivered_at).toLocaleDateString("pt-BR")}</span>}
                {totalMs&&<span>⏱ {fmtMs(totalMs)} total{workMs&&workMs!==totalMs?` · ${fmtMs(workMs)} em serviço`:""}</span>}
              </div>
              {/* Extras: fuel, tows, discount */}
              {(Number(h.fuel_cost||0)>0||(h.tows||[]).length>0||Number(h.os_discount_pct||0)>0)&&
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:6}}>
                  {Number(h.fuel_cost||0)>0&&<span style={{fontSize:10,color:B.amber,background:`${B.amber}15`,border:`1px solid ${B.amber}33`,borderRadius:5,padding:"1px 7px"}}>⛽ {fmtBRL(h.fuel_cost)}</span>}
                  {(h.tows||[]).map((t,i)=>Number(t.value||0)>0&&<span key={i} style={{fontSize:10,color:"#60a5fa",background:"#60a5fa15",border:"1px solid #60a5fa33",borderRadius:5,padding:"1px 7px"}}>🚛 {t.origin&&t.destination?`${t.origin}→${t.destination} · `:""}{fmtBRL(t.value)}</span>)}
                  {Number(h.os_discount_pct||0)>0&&<span style={{fontSize:10,color:B.red,background:`${B.red}15`,border:`1px solid ${B.red}33`,borderRadius:5,padding:"1px 7px"}}>🏷️ -{h.os_discount_pct}% m.o.</span>}
                </div>}
              {hTasks.length>0&&<div style={{display:"flex",flexDirection:"column",gap:3}}>
                {hTasks.map((t,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 6px",background:t.done?B.greenBg:`${B.amber}11`,borderRadius:5}}>
                  <span style={{fontSize:10}}>{t.done?"✅":"⏳"}</span>
                  <span style={{fontSize:11.5,color:B.gray200,flex:1}}>{t.label}</span>
                  {taskCost(t,defaultRate).total>0&&<span style={{fontSize:10,color:t.done?B.green:B.amber,fontWeight:700}}>{fmtBRL(taskCost(t,defaultRate).total)}</span>}
                </div>)}
              </div>}
            </div>);
          })}
        </div>}
      </div>}
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
    .sort((a,b)=>{
    const pri={high:0,medium:1,low:2};
    const pA=pri[a.priority||"medium"], pB=pri[b.priority||"medium"];
    if(pA!==pB) return pA-pB;
    return (a.status==="paused"?1:0)-(b.status==="paused"?1:0);
  });
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
  // Inject responsive styles once
  useEffect(()=>{
    if(document.getElementById("osc-responsive-styles")) return;
    const s=document.createElement("style");
    s.id="osc-responsive-styles";
    s.textContent=`
      @media (max-width: 600px) {
        .osc-topbar-stats { display: none !important; }
        .osc-topbar-inner { height: auto !important; padding: 10px 0 !important; flex-wrap: wrap; gap: 8px !important; }
        .osc-topbar-brand { flex: 1; }
        .osc-topbar-actions { flex-wrap: nowrap !important; margin-left: auto; }
        .osc-vhc-header { flex-direction: column !important; align-items: flex-start !important; gap: 8px !important; }
        .osc-vhc-timer { width: 100% !important; text-align: left !important; }
        .osc-vhc-timer > div { display: flex !important; align-items: center !important; gap: 8px !important; }
        .osc-vhc-summary { width: 100% !important; text-align: left !important; flex-direction: row !important; gap: 12px !important; }
        .osc-tab-btn span.tab-label { display: none; }
      }
    `;
    document.head.appendChild(s);
  },[]);

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
  const [osHistory, setOsHistory]=useState([]);
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
      setOsHistory(d.osHistory||[]);
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
  const addVeh=async(eid,model,plate,color="")=>{
    try{
      const row=await db.addVehicle({employeeId:eid,clientId:null,model,plate,color,photo:null,photos:[]});
      row.mechanicIds=[eid];
      setVeh(p=>[...p,row]); toast_("Veículo adicionado ✓");
    }catch(e){errToast(e);}
  };

  // Create vehicle from Vehicles tab — optionally link to existing or new client
  const createVehicleFromTab=async({model,plate,clientId,newClient})=>{
    try{
      let finalClientId=clientId||null;
      // If user typed a new client, create it first
      if(newClient?.name?.trim()){
        const row=await db.addClient(newClient.name.trim(),newClient.phone?.trim()||"",newClient.email?.trim()||"");
        setCli(p=>[...p,row]);
        finalClientId=row.id;
      }
      const vRow=await db.addVehicle({employeeId:null,clientId:finalClientId,model:model.trim(),plate:plate.trim().toUpperCase(),color:(data.color||"").trim(),year:data.year||null,photo:null,photos:[]});
      // Hydrate mechanicIds for UI consistency
      vRow.mechanicIds=[];
      setVeh(p=>[...p,vRow]);
      toast_("Veículo cadastrado ✓");
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

  const deliverVehicle=async(vid)=>{
    const v=vehicles.find(x=>x.id===vid);
    if(!v)return;
    const nowMs=Date.now();
    const deliveredAt=new Date().toISOString();

    // Accumulate any active pause time
    let totalPausedMs=v.totalPausedMs||0;
    if(v.status==="paused"&&v.pausedAt){
      totalPausedMs+=nowMs-new Date(v.pausedAt).getTime();
    }

    // Snapshot current tasks for history
    const vTasks=tasks.filter(t=>t.vehicleId===vid);
    const tasksValue=vTasks.reduce((s,t)=>s+taskCost(t,defaultRate).total,0);
    const towTotal=(v.tows||[]).reduce((s,t)=>s+Number(t.value||0),0);
    const laborSum=vTasks.reduce((s,t)=>s+taskCost(t,defaultRate).labor,0);
    const osDiscountAmt=laborSum*Number(v.osDiscountPct||0)/100;
    const totalValue=tasksValue+Number(v.fuelCost||0)+towTotal-osDiscountAmt;

    const historyRecord={
      osNumber: v.osNumber,
      clientId: v.clientId,
      mechanicIds: v.mechanicIds||[],
      enteredAt: v.enteredAt,
      deliveredAt,
      totalPausedMs,
      tasksSnapshot: vTasks,
      fuelCost: v.fuelCost||0,
      tows: v.tows||[],
      osDiscountPct: v.osDiscountPct||0,
      totalValue,
    };

    // Optimistic UI: update vehicle, remove its tasks, add to history
    const newOsEntry={
      id:`local-${Date.now()}`,
      vehicle_id:vid,
      ...historyRecord,
      created_at:deliveredAt,
    };
    setVeh(p=>p.map(x=>x.id===vid?{
      ...x,
      deliveredAt,
      status:"active",
      pausedAt:null,
      totalPausedMs:0,
      enteredAt:null,
      osNumber:null,
      priority:"medium",
      fuelCost:0,
      tows:[],
      osDiscountPct:0,
    }:x));
    setTsk(p=>p.filter(t=>t.vehicleId!==vid));
    setOsHistory(p=>[newOsEntry,...p]);

    try{
      await db.archiveAndResetVehicle(vid,historyRecord);
      toast_("Veículo entregue e OS arquivada ✓");
    }catch(e){
      errToast(e);
      const d=await db.loadAll();
      setVeh(d.vehicles); setTsk(d.tasks); setOsHistory(d.osHistory||[]);
    }
  };

  const openNewOS=async(vid,employeeId,enteredAtStr)=>{
    try{
      const osNumber=await db.openNewOS(vid,employeeId);
      const enteredAt=enteredAtStr?new Date(enteredAtStr).toISOString():new Date().toISOString();
      setVeh(p=>p.map(x=>x.id===vid?{
        ...x, osNumber, enteredAt,
        status:"active", pausedAt:null, totalPausedMs:0, priority:"medium",
        deliveredAt:null,
        mechanicIds:[...new Set([...(x.mechanicIds||[]),employeeId])],
      }:x));
      toast_(`OS ${fmtOS(osNumber)} aberta ✓`);
    }catch(e){ errToast(e); }
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
    // If materials changed, check if any fromStock item qty changed and sync stock balance
    if(patch.materials){
      const oldTask=tasks.find(t=>t.id===id);
      const oldMats=oldTask?.materials||[];
      const newMats=patch.materials;
      // For each fromStock material, compare old qty vs new qty and adjust stock
      newMats.forEach(nm=>{
        if(!nm.fromStock||!nm.stockItemId) return;
        const oldMat=oldMats.find(om=>om.fromStock&&om.stockItemId===nm.stockItemId);
        const oldQty=Number(oldMat?.qty||0);
        const newQty=Number(nm.qty||1);
        const delta=newQty-oldQty; // positive = more consumed, negative = returned
        if(delta!==0){
          setStk(p=>p.map(s=>s.id===nm.stockItemId?{...s,qty:Math.max(0,s.qty-delta)}:s));
          const stockItem=stock.find(s=>s.id===nm.stockItemId);
          if(stockItem) db.updateStock(nm.stockItemId,{qty:Math.max(0,stockItem.qty-delta)}).catch(()=>{});
        }
      });
    }
    setTsk(p=>p.map(t=>t.id===id?{...t,...patch}:t));
    try{ await db.updateTask(id,patch); }catch(e){errToast(e);}
  };
  // Adds a stock item as a new material entry (list grows, no limit)
  const consumeStock=async(taskId,item,currentMats)=>{
    const matQty=1; // initial qty when adding from stock picker — user can edit afterwards
    const newQty=Math.max(0,item.qty-matQty);
    const mats = currentMats || tasks.find(t=>t.id===taskId)?.materials || [];
    const newMats = [...mats,{name:item.name,cost:item.costPrice,qty:matQty,fromStock:true,stockItemId:item.id}];
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
  // Recalculates weighted average unit cost from all purchases of a stock item
  const recalcStockCost=async(stockId, allPurchases)=>{
    const itemPurchases=allPurchases.filter(p=>p.stockId===stockId);
    if(itemPurchases.length===0) return;
    const totalQty=itemPurchases.reduce((s,p)=>s+Number(p.qty||0),0);
    if(totalQty<=0) return;
    const totalCost=itemPurchases.reduce((s,p)=>s+Number(p.qty||0)*Number(p.unitCost||0),0);
    const avgCost=totalCost/totalQty;
    const item=stock.find(s=>s.id===stockId);
    if(!item) return;
    const newSalePrice=avgCost*(1+Number(item.markup||0)/100);
    setStk(p=>p.map(s=>s.id===stockId?{...s,costPrice:avgCost,salePrice:newSalePrice}:s));
    try{ await db.updateStock(stockId,{costPrice:avgCost,salePrice:newSalePrice}); }catch(e){}
  };

  const addPurchase=async(purchase)=>{
    try{
      const row=await db.addPurchase(purchase);
      const newPurchases=[row,...stockPurchases];
      setStockPurchases(newPurchases);
      // Update stock balance
      const item=stock.find(s=>s.id===purchase.stockId);
      if(item){
        const newQty=item.qty+purchase.qty;
        setStk(p=>p.map(s=>s.id===purchase.stockId?{...s,qty:newQty}:s));
        await db.updateStock(purchase.stockId,{qty:newQty});
      }
      // Recalculate weighted average cost
      await recalcStockCost(purchase.stockId, newPurchases);
      toast_(`Compra registrada: +${purchase.qty} ${item?.name||""} ✓`);
    }catch(e){errToast(e);}
  };
  const updatePurchase=async(id,patch)=>{
    const newPurchases=stockPurchases.map(x=>x.id===id?{...x,...patch}:x);
    setStockPurchases(newPurchases);
    try{
      await db.updatePurchase(id,patch);
      // Recalculate after edit
      const affected=newPurchases.find(p=>p.id===id);
      if(affected) await recalcStockCost(affected.stockId,newPurchases);
      toast_("Compra atualizada ✓");
    }catch(e){errToast(e);}
  };
  const deletePurchase=async(id)=>{
    const affected=stockPurchases.find(p=>p.id===id);
    const newPurchases=stockPurchases.filter(x=>x.id!==id);
    setStockPurchases(newPurchases);
    try{
      await db.deletePurchase(id);
      // Recalculate after deletion
      if(affected) await recalcStockCost(affected.stockId,newPurchases);
      toast_("Compra excluída ✓");
    }catch(e){errToast(e);}
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
  const tabBtn=(key,lbl,ico,ac)=>(<button className="osc-tab-btn" onClick={()=>setTab(key)} style={{display:"flex",alignItems:"center",gap:5,padding:"7px 12px",borderRadius:8,border:"none",cursor:"pointer",fontWeight:700,fontSize:12,transition:"all .2s",background:tab===key?ac:"transparent",color:tab===key?B.white:B.gray400}}>{ico}<span className="tab-label">{lbl}</span></button>);
  const IGear2=()=><Svg d="M12 15a3 3 0 100-6 3 3 0 000 6z" d2="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" s={17} c={B.amber}/>;

  return (<div style={{minHeight:"100vh",background:B.black,fontFamily:"'Inter','Segoe UI',sans-serif",color:B.white}}>
    {/* Topbar */}
    <div style={{background:B.gray900,borderBottom:`1px solid ${B.gray700}`,padding:"0 20px",position:"sticky",top:0,zIndex:20,boxShadow:"0 2px 20px rgba(0,0,0,.6)"}}>
      <div className="osc-topbar-inner" style={{maxWidth:820,margin:"0 auto",display:"flex",alignItems:"center",height:60,gap:12}}>
        <div className="osc-topbar-brand" style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
          <div style={{width:38,height:38,borderRadius:9,background:B.orange,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><IWrench s={20} c={B.white}/></div>
          <div><div style={{fontWeight:900,fontSize:15,color:B.white,letterSpacing:"-.5px"}}>OSC <span style={{color:B.orange}}>Performance</span></div><div style={{fontSize:9,color:B.gray400,textTransform:"uppercase",letterSpacing:.6}}>{ROLE_CONFIG[adminRole]?.label||"Gestão de Oficina"}</div></div>
        </div>
        <div className="osc-topbar-stats" style={{marginLeft:"auto",display:"flex",gap:5,alignItems:"center"}}>
          {[{l:"Mec.",v:employees.length,c:B.orange},{l:"Clientes",v:clients.length,c:B.blue},{l:"Veículos",v:vehicles.length,c:B.gray200},{l:"Tarefas",v:`${doneT}/${tasks.length}`,c:B.green},{l:"Estoque",v:stock.length,c:B.purple}].map(s=>(
            <div key={s.l} style={{textAlign:"center",background:B.gray800,borderRadius:7,padding:"3px 8px",border:`1px solid ${B.gray700}`}}>
              <div style={{fontSize:12,fontWeight:800,color:s.c}}>{s.v}</div><div style={{fontSize:9,color:B.gray400,whiteSpace:"nowrap"}}>{s.l}</div>
            </div>))}
        </div>
        <div className="osc-topbar-actions" style={{display:"flex",gap:5,alignItems:"center",marginLeft:"auto"}}>
          <button onClick={()=>{navigator.clipboard?.writeText(getMechanicPortalLink());toast_("Link da área do mecânico copiado ✓");}} title="Copiar link da área do mecânico" style={{width:34,height:34,borderRadius:8,background:`${B.orange}22`,border:`1px solid ${B.orange}44`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
            <ILock s={16} c={B.orange}/>
          </button>
          <button onClick={()=>setSCfg(true)} style={{width:34,height:34,borderRadius:8,background:B.amberBg,border:`1px solid ${B.amber}44`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
            <IGear2/>
          </button>
          <button onClick={()=>{setAdminRole(null);try{sessionStorage.removeItem(ADMIN_SESSION_KEY);}catch{}}} title="Sair (logout)" style={{width:34,height:34,borderRadius:8,background:`${B.red}1a`,border:`1px solid ${B.red}44`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
            <ILogout s={16} c={B.red}/>
          </button>
        </div>
      </div>
    </div>

    <div style={{maxWidth:820,margin:"0 auto",padding:"20px 14px"}}>
      {/* Tabs */}
      <div style={{display:"flex",justifyContent:"center",marginBottom:20}}>
      <div style={{display:"flex",gap:3,background:B.gray900,padding:4,borderRadius:12,border:`1px solid ${B.gray700}`,flexWrap:"wrap",justifyContent:"center"}}>
        {allowedTabs.includes("mechanics")&&tabBtn("mechanics","Mecânicos",<IWrench s={13}/>,B.orange)}
        {allowedTabs.includes("clients")&&tabBtn("clients","Ordens de Serviço",<IFileText s={13}/>,B.blue)}
        {allowedTabs.includes("stock")&&tabBtn("stock","Estoque",<IWarehouse s={13}/>,B.purple)}
        {allowedTabs.includes("vehicles")&&tabBtn("vehicles","Veículos",<ICar s={13}/>,B.blue)}
        {allowedTabs.includes("clientsMonitor")&&tabBtn("clientsMonitor","Clientes",<IAddressBook s={13}/>,`#0891b2`)}
        {allowedTabs.includes("finance")&&tabBtn("finance","Financeiro",<IChart s={13}/>,B.green)}
      </div>
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
            onAddMechanic={addVehicleMechanic} onRemoveMechanic={removeVehicleMechanic} onSetStatus={setVehicleStatus} onDeliver={deliverVehicle} isOwner={adminRole==="owner"}
            onDelete={delEmp} onSendWA={sendMechWA} onUpdatePhone={updEmpP} onUpdateName={updEmpN}/>)}
      </>}

      {/* ══ CLIENTS ══ */}
      {tab==="clients"&&allowedTabs.includes("clients")&&<>
        <div style={{marginBottom:14,padding:"9px 13px",background:B.blueBg,border:`1px solid ${B.blue}44`,borderRadius:9,fontSize:12,color:B.gray200}}>
          🔧 <b style={{color:B.blue}}>Ordens de Serviço</b> em andamento. Preço/h atual: <b style={{color:B.amber}}>{fmtBRL(defaultRate)}/h</b>
        </div>
        {(()=>{
          const activeVehicles=vehicles.filter(v=>v.enteredAt||tasks.some(t=>t.vehicleId===v.id));
          if(activeVehicles.length===0) return (
            <div style={{textAlign:"center",padding:"56px 0",color:B.gray400}}>
              <div style={{fontSize:44,marginBottom:12}}>🔧</div>
              <div style={{fontWeight:700,fontSize:15,color:B.gray200,marginBottom:4}}>Nenhuma OS em andamento</div>
              <div style={{fontSize:13}}>Os veículos aparecem aqui quando têm uma OS aberta.</div>
            </div>
          );
          // Group by mechanics — a vehicle may belong to multiple mechanics
          // Build groups: one per employee, plus "Sem mecânico"
          const groups=[];
          const assignedVehicleIds=new Set();
          employees.forEach(emp=>{
            const empVs=activeVehicles.filter(v=>(v.mechanicIds||[]).includes(emp.id));
            if(empVs.length>0){
              groups.push({emp,vehicles:empVs});
              empVs.forEach(v=>assignedVehicleIds.add(v.id));
            }
          });
          const unassigned=activeVehicles.filter(v=>!assignedVehicleIds.has(v.id));
          if(unassigned.length>0) groups.push({emp:null,vehicles:unassigned});
          const sortVehicles=vs=>[...vs].sort((a,b)=>{
            const pri={high:0,medium:1,low:2};
            const pA=pri[a.priority||"medium"],pB=pri[b.priority||"medium"];
            if(pA!==pB) return pA-pB;
            if(a.enteredAt&&b.enteredAt) return new Date(a.enteredAt)-new Date(b.enteredAt);
            return 0;
          });
          return <OsGroupedView groups={groups} sortVehicles={sortVehicles}
            tasks={tasks} employees={employees} clients={clients} stock={stock} defaultRate={defaultRate} company={company}
            addTask={addTask} toggleT={toggleT} delTask={delTask} updTask={updTask} updVeh={updVeh} delVeh={delVeh}
            xferMech={xferMech} xferOwn={xferOwn} consumeStock={consumeStock} returnStock={returnStock}
            payments={payments} addPayment={addPayment} deletePayment={deletePayment}
            addVehicleMechanic={addVehicleMechanic} removeVehicleMechanic={removeVehicleMechanic}
            setVehicleStatus={setVehicleStatus} deliverVehicle={deliverVehicle} adminRole={adminRole}/>;
        })()}
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
        <VehiclesTab vehicles={vehicles} tasks={tasks} employees={employees} clients={clients} defaultRate={defaultRate} onUpdateVehicle={updVeh} osHistory={osHistory} onOpenOS={openNewOS} company={company} onCreateVehicle={createVehicleFromTab}/>
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
