import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://lchfmoeyzgbepunetuch.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjaGZtb2V5emdiZXB1bmV0dWNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NzEzOTUsImV4cCI6MjA5ODM0NzM5NX0.2RTbc1Dd_VWGT56ak1T41HH2zGXCS6MDbnXe4EY3SYQ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Realtime subscription ─────────────────────────────────────────────────────
// Calls onEvent({ table, eventType, record, old }) whenever DB changes
export function subscribeToChanges(onEvent) {
  const channel = supabase
    .channel("osc-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "tasks" },
      (payload) => onEvent({ table: "tasks", ...payload }))
    .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" },
      (payload) => onEvent({ table: "vehicles", ...payload }))
    .on("postgres_changes", { event: "*", schema: "public", table: "payments" },
      (payload) => onEvent({ table: "payments", ...payload }))
    .on("postgres_changes", { event: "*", schema: "public", table: "employees" },
      (payload) => onEvent({ table: "employees", ...payload }))
    .on("postgres_changes", { event: "*", schema: "public", table: "stock" },
      (payload) => onEvent({ table: "stock", ...payload }))
    .on("postgres_changes", { event: "*", schema: "public", table: "investments" },
      (payload) => onEvent({ table: "investments", ...payload }))
    .on("postgres_changes", { event: "*", schema: "public", table: "purchase_orders" },
      (payload) => onEvent({ table: "purchase_orders", ...payload }))
    .on("postgres_changes", { event: "*", schema: "public", table: "expenses" },
      (payload) => onEvent({ table: "expenses", ...payload }))
    .on("postgres_changes", { event: "*", schema: "public", table: "internal_transfers" },
      (payload) => onEvent({ table: "internal_transfers", ...payload }))
    .on("postgres_changes", { event: "*", schema: "public", table: "appointments" },
      (payload) => onEvent({ table: "appointments", ...payload }))
    .on("postgres_changes", { event: "*", schema: "public", table: "appointment_services" },
      (payload) => onEvent({ table: "appointment_services", ...payload }))
    .on("postgres_changes", { event: "*", schema: "public", table: "appointment_payments" },
      (payload) => onEvent({ table: "appointment_payments", ...payload }))
    .on("postgres_changes", { event: "*", schema: "public", table: "os_history" },
      (payload) => onEvent({ table: "os_history", ...payload }))
    .on("postgres_changes", { event: "*", schema: "public", table: "clients" },
      (payload) => onEvent({ table: "clients", ...payload }))
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// ─── Image upload to Supabase Storage ────────────────────────────────────────
export async function uploadPhoto(file, folder = "misc") {
  const ext = file.name?.split(".").pop() || "jpg";
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from("photos").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("photos").getPublicUrl(path);
  return data.publicUrl;
}

// Resize before upload to keep things fast & cheap
export async function resizeAndUpload(file, folder = "misc", maxW = 1000, quality = 0.78) {
  const resizedBlob = await resizeToBlob(file, maxW, quality);
  const ext = "jpg";
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from("photos").upload(path, resizedBlob, {
    cacheControl: "3600",
    contentType: "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("photos").getPublicUrl(path);
  return data.publicUrl;
}

function resizeToBlob(file, maxW, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Mappers: DB (snake_case) <-> App (camelCase) ────────────────────────────
const mapVehicleIn = (v) => ({
  id: v.id,
  employeeId: v.employee_id,         // legacy, kept for compat
  clientId: v.client_id,             // legacy, kept for compat
  model: v.model,
  plate: v.plate,
  color: v.color || '',
  year: v.year || null,
  photo: v.photo,
  photos: v.photos || [],
  enteredAt: v.entered_at || null,
  deliveredAt: v.delivered_at || null,
  createdAt: v.created_at,
  osNumber: v.os_number || null,
  status: v.status || "active",
  pausedAt: v.paused_at || null,
  totalPausedMs: Number(v.total_paused_ms || 0),
  priority: v.priority || "medium",
  sortOrder: Number(v.sort_order || 0),
  urgent: v.urgent || false,
  fuelCost: Number(v.fuel_cost || 0),
  fuels: Array.isArray(v.fuels) ? v.fuels : (v.fuels ? JSON.parse(v.fuels) : []),
  checklist: Array.isArray(v.checklist) ? v.checklist : (v.checklist ? JSON.parse(v.checklist) : []),
  osNumberFinishing:     v.os_number_finishing || null,
  enteredAtFinishing:    v.entered_at_finishing || null,
  statusFinishing:       v.status_finishing || 'active',
  pausedAtFinishing:     v.paused_at_finishing || null,
  totalPausedMsFinishing:Number(v.total_paused_ms_finishing || 0),
  photosFinishing:       Array.isArray(v.photos_finishing) ? v.photos_finishing : (v.photos_finishing ? JSON.parse(v.photos_finishing) : []),
  notesFinishing:        v.notes_finishing || '',
  checklistFinishing:    Array.isArray(v.checklist_finishing) ? v.checklist_finishing : (v.checklist_finishing ? JSON.parse(v.checklist_finishing) : []),
  osDiscountPctFinishing:Number(v.os_discount_pct_finishing || 0),
  partsList: Array.isArray(v.parts_list) ? v.parts_list : (v.parts_list ? JSON.parse(v.parts_list) : []),
  partsListFinishing: Array.isArray(v.parts_list_finishing) ? v.parts_list_finishing : (v.parts_list_finishing ? JSON.parse(v.parts_list_finishing) : []),
  osDiscountPct: Number(v.os_discount_pct || 0),
  tows: Array.isArray(v.tows) ? v.tows : (v.tows ? JSON.parse(v.tows) : []),
  freights: Array.isArray(v.freights) ? v.freights : (v.freights ? JSON.parse(v.freights) : []),
  notes: v.notes || '',
  // Finishing Division
  osNumberFinishing: v.os_number_finishing || null,
  enteredAtFinishing: v.entered_at_finishing || null,
  statusFinishing: v.status_finishing || 'active',
  pausedAtFinishing: v.paused_at_finishing || null,
  totalPausedMsFinishing: Number(v.total_paused_ms_finishing || 0),
  photosFinishing: Array.isArray(v.photos_finishing) ? v.photos_finishing : (v.photos_finishing ? JSON.parse(v.photos_finishing) : []),
  notesFinishing: v.notes_finishing || '',
  checklistFinishing: Array.isArray(v.checklist_finishing) ? v.checklist_finishing : (v.checklist_finishing ? JSON.parse(v.checklist_finishing) : []),
  osDiscountPctFinishing: Number(v.os_discount_pct_finishing || 0),
  mechanicIds: [],    // hydrated separately after load
  currentClientId: v.client_id,      // convenience alias
});
const mapVehicleOut = (v) => ({
  employee_id: v.employeeId,
  client_id: v.clientId,
  model: v.model,
  plate: v.plate,
  color: v.color || '',
  year: v.year || null,
  photo: v.photo,
  photos: v.photos,
  entered_at: v.enteredAt || null,
});
const mapTaskIn = (t) => ({
  id: t.id,
  vehicleId: t.vehicle_id,
  label: t.label,
  done: t.done,
  materials: t.materials || [],
  hours: t.hours,
  ratePerHour: t.rate_per_hour,
  completedAt: t.completed_at,
  completedByEmployeeId: t.completed_by_employee_id || null,
  outsourced: t.outsourced || false,
  warranty: t.warranty || false,
  discount: Number(t.discount || 0),
  category: t.category || null,
  description: t.description || '',
  rateType: t.rate_type || 'hour',
  division: t.division || 'performance',
  updates: Array.isArray(t.updates) ? t.updates : [],
});
const mapTaskOut = (t) => ({
  vehicle_id: t.vehicleId,
  label: t.label,
  done: t.done,
  materials: t.materials || [],
  hours: t.hours,
  rate_per_hour: t.ratePerHour,
  completed_at: t.completedAt || null,
  category: t.category || null,
  division: t.division || 'performance',
  rate_type: t.rateType || 'hour',
  description: t.description || '',
  outsourced: t.outsourced || false,
  warranty: t.warranty || false,
  discount: Number(t.discount || 0),
});
const mapStockIn = (s) => ({
  id: s.id,
  name: s.name,
  brand: s.brand,
  type: s.type,
  qty: s.qty,
  costPrice: s.cost_price,
  markup: s.markup,
  salePrice: s.sale_price,
  photo: s.photo,
  location: s.location || "",
  minQty: s.min_qty != null ? s.min_qty : 2,
  orderLink: s.order_link || "",
});
const mapStockOut = (s) => ({
  name: s.name,
  brand: s.brand,
  type: s.type,
  qty: s.qty,
  cost_price: s.costPrice,
  markup: s.markup,
  sale_price: s.salePrice,
  photo: s.photo,
  location: s.location || "",
  min_qty: s.minQty != null ? s.minQty : 2,
});

const mapPurchaseIn = (p) => ({
  id: p.id,
  stockId: p.stock_id,
  purchaseDate: p.purchase_date,
  supplier: p.supplier,
  qty: p.qty,
  unitCost: Number(p.unit_cost),
  totalCost: Number(p.total_cost),
  invoiceNumber: p.invoice_number,
});

const mapPaymentIn = (p) => ({
  id: p.id,
  vehicleId: p.vehicle_id,
  osHistoryId: p.os_history_id || null,
  amount: Number(p.amount),
  method: p.method,
  paidAt: p.paid_at,
  division: p.division || 'performance',
  note: p.note,
});

// ─── Data API ─────────────────────────────────────────────────────────────────
export const db = {
  // Load everything at once
  async loadAll() {
    const [emp, cli, veh, tsk, stk, set, pay, pur, vmec, vown, osh] = await Promise.all([
      supabase.from("employees").select("*").order("created_at"),
      supabase.from("clients").select("*").order("created_at"),
      supabase.from("vehicles").select("*").order("created_at"),
      supabase.from("tasks").select("*").order("created_at"),
      supabase.from("stock").select("*").order("created_at"),
      supabase.from("settings").select("*").eq("id", 1).single(),
      supabase.from("payments").select("*").order("paid_at"),
      supabase.from("stock_purchases").select("*").order("purchase_date", { ascending: false }),
      supabase.from("vehicle_mechanics").select("*"),
      supabase.from("vehicle_owners").select("*").order("started_at"),
      supabase.from("os_history").select("*").order("delivered_at", { ascending: false }),
    ]);
    const mechMap = {};
    (vmec.data || []).forEach(r => {
      if (!mechMap[r.vehicle_id]) mechMap[r.vehicle_id] = [];
      mechMap[r.vehicle_id].push(r.employee_id);
    });
    const ownerMap = {};
    (vown.data || []).forEach(r => {
      if (r.is_current) ownerMap[r.vehicle_id] = r.client_id;
    });
    const vehicles = (veh.data || []).map(v => {
      const mapped = mapVehicleIn(v);
      mapped.mechanicIds = mechMap[v.id] || (v.employee_id ? [v.employee_id] : []);
      mapped.clientId = ownerMap[v.id] ?? v.client_id;
      mapped.currentClientId = mapped.clientId;
      return mapped;
    });
    return {
      employees: emp.data || [],
      clients: cli.data || [],
      vehicles,
      tasks: (tsk.data || []).map(mapTaskIn),
      stock: (stk.data || []).map(mapStockIn),
      defaultRate: set.data?.default_rate || 0,
      company: {
        name: set.data?.company_name || "OSC Performance",
        address: set.data?.company_address || "",
        phone: set.data?.company_phone || "",
        document: set.data?.company_document || "",
      },
      payments: (pay.data || []).map(mapPaymentIn),
      stockPurchases: (pur.data || []).map(mapPurchaseIn),
      vehicleOwners: vown.data || [],
      osHistory: osh.data || [],
    };
  },

  // Employees
  async addEmployee(name, phone, division="performance") {
    const { data, error } = await supabase.from("employees").insert({ name, phone, division }).select().single();
    if (error) throw error;
    return data;
  },
  async updateEmployee(id, patch) {
    const { error } = await supabase.from("employees").update(patch).eq("id", id);
    if (error) throw error;
  },
  async deleteEmployee(id) {
    const { error } = await supabase.from("employees").delete().eq("id", id);
    if (error) throw error;
  },

  // Clients
  async addClient(name, phone, email="") {
    const { data, error } = await supabase.from("clients").insert({ name, phone, email }).select().single();
    if (error) throw error;
    return data;
  },
  async updateClient(id, patch) {
    const allowed = {};
    if ("name"  in patch) allowed.name  = patch.name;
    if ("phone" in patch) allowed.phone = patch.phone;
    if ("email" in patch) allowed.email = patch.email;
    const { error } = await supabase.from("clients").update(allowed).eq("id", id);
    if (error) throw error;
  },
  async deleteClient(id) {
    const { error } = await supabase.from("clients").delete().eq("id", id);
    if (error) throw error;
  },

  // Vehicles
  async addVehicle(v) {
    const { data, error } = await supabase.from("vehicles").insert(mapVehicleOut(v)).select().single();
    if (error) throw error;
    return mapVehicleIn(data);
  },

  // Open a new OS on an existing vehicle: generate OS number, set entered_at, assign mechanic
  async openNewOS(vehicleId, employeeId) {
    // Use Postgres to get next OS number via RPC or update
    // We update the vehicle with entered_at + reset fields, then get the new os_number via a DB function
    // Since we can't call nextval directly from JS, we insert a dummy and read back
    const enteredAt = new Date().toISOString();
    // Trick: set os_number to null first so the default nextval fires on update via a workaround —
    // actually we'll use a raw SQL RPC. Simpler: use upsert to trigger default.
    // Cleanest approach: update with os_number = nextval via SQL function call
    const { data, error } = await supabase.rpc("open_vehicle_os", {
      p_vehicle_id: vehicleId,
      p_employee_id: employeeId,
      p_entered_at: enteredAt,
    });
    if (error) throw error;
    return data; // returns the new os_number
  },

  async openNewOSFinishing(vehicleId, employeeId) {
    const enteredAt = new Date().toISOString();
    const { data, error } = await supabase.rpc("open_vehicle_os_finishing", {
      p_vehicle_id: vehicleId,
      p_employee_id: employeeId,
      p_entered_at: enteredAt,
    });
    if (error) throw error;
    return data; // returns the new os_number_finishing
  },

  async updateVehicle(id, patch) {
    const dbPatch = {};
    if ("employeeId"             in patch) dbPatch.employee_id              = patch.employeeId;
    if ("clientId"               in patch) dbPatch.client_id                = patch.clientId;
    if ("model"                  in patch) dbPatch.model                    = patch.model;
    if ("plate"                  in patch) dbPatch.plate                    = patch.plate;
    if ("color"                  in patch) dbPatch.color                    = patch.color;
    if ("year"                   in patch) dbPatch.year                     = patch.year;
    if ("photo"                  in patch) dbPatch.photo                    = patch.photo;
    if ("photos"                 in patch) dbPatch.photos                   = patch.photos;
    if ("enteredAt"              in patch) dbPatch.entered_at               = patch.enteredAt;
    if ("deliveredAt"            in patch) dbPatch.delivered_at             = patch.deliveredAt;
    if ("status"                 in patch) dbPatch.status                   = patch.status;
    if ("priority"               in patch) dbPatch.priority                 = patch.priority;
    if ("sortOrder"              in patch) dbPatch.sort_order               = patch.sortOrder;
    if ("urgent"                 in patch) dbPatch.urgent                   = patch.urgent;
    if ("fuelCost"               in patch) dbPatch.fuel_cost                = patch.fuelCost;
    if ("fuels"                  in patch) dbPatch.fuels                    = patch.fuels;
    if ("tows"                   in patch) dbPatch.tows                     = patch.tows;
    if ("freights"               in patch) dbPatch.freights                 = patch.freights;
    if ("notes"                  in patch) dbPatch.notes                    = patch.notes;
    if ("pausedAt"               in patch) dbPatch.paused_at                = patch.pausedAt;
    if ("totalPausedMs"          in patch) dbPatch.total_paused_ms          = patch.totalPausedMs;
    if ("osDiscountPct"          in patch) dbPatch.os_discount_pct          = patch.osDiscountPct;
    if ("checklist"              in patch) dbPatch.checklist                = patch.checklist;
    if ("partsList"              in patch) dbPatch.parts_list               = patch.partsList;
    if ("partsListFinishing"     in patch) dbPatch.parts_list_finishing     = patch.partsListFinishing;
    // Finishing fields
    if ("osNumberFinishing"       in patch) dbPatch.os_number_finishing      = patch.osNumberFinishing;
    if ("enteredAtFinishing"      in patch) dbPatch.entered_at_finishing     = patch.enteredAtFinishing;
    if ("statusFinishing"         in patch) dbPatch.status_finishing         = patch.statusFinishing;
    if ("pausedAtFinishing"       in patch) dbPatch.paused_at_finishing      = patch.pausedAtFinishing;
    if ("totalPausedMsFinishing"  in patch) dbPatch.total_paused_ms_finishing= patch.totalPausedMsFinishing;
    if ("photosFinishing"         in patch) dbPatch.photos_finishing         = patch.photosFinishing;
    if ("notesFinishing"          in patch) dbPatch.notes_finishing          = patch.notesFinishing;
    if ("checklistFinishing"      in patch) dbPatch.checklist_finishing      = patch.checklistFinishing;
    if ("osDiscountPctFinishing"  in patch) dbPatch.os_discount_pct_finishing= patch.osDiscountPctFinishing;
    const { error } = await supabase.from("vehicles").update(dbPatch).eq("id", id);
    if (error) throw error;
  },
  async deleteVehicle(id) {
    const { error } = await supabase.from("vehicles").delete().eq("id", id);
    if (error) throw error;
  },

  // Vehicle mechanics (multi-mechanic)
  async addVehicleMechanic(vehicleId, employeeId) {
    const { error } = await supabase.from("vehicle_mechanics").insert({ vehicle_id: vehicleId, employee_id: employeeId });
    if (error) throw error;
  },
  async removeVehicleMechanic(vehicleId, employeeId) {
    const { error } = await supabase.from("vehicle_mechanics").delete().eq("vehicle_id", vehicleId).eq("employee_id", employeeId);
    if (error) throw error;
  },

  // Vehicle owner transfer
  async transferVehicleOwner(vehicleId, newClientId) {
    await supabase.from("vehicle_owners")
      .update({ ended_at: new Date().toISOString(), is_current: false })
      .eq("vehicle_id", vehicleId).eq("is_current", true);
    const { error } = await supabase.from("vehicle_owners").insert({
      vehicle_id: vehicleId, client_id: newClientId,
      started_at: new Date().toISOString(), is_current: true,
    });
    if (error) throw error;
    await supabase.from("vehicles").update({ client_id: newClientId }).eq("id", vehicleId);
  },

  // Archive current OS to history and reset vehicle for next OS
  async archiveAndResetVehicle(vehicleId, historyRecord) {
    // 1) Save OS snapshot to os_history — try with photos first, fallback without
    let hData, hErr;
    const insertPayload = {
      vehicle_id: vehicleId,
      os_number: historyRecord.osNumber,
      client_id: historyRecord.clientId,
      mechanic_ids: historyRecord.mechanicIds,
      entered_at: historyRecord.enteredAt,
      delivered_at: historyRecord.deliveredAt,
      total_paused_ms: historyRecord.totalPausedMs || 0,
      tasks_snapshot: historyRecord.tasksSnapshot,
      fuel_cost: historyRecord.fuelCost || 0,
      fuels: historyRecord.fuels || [],
      tows: historyRecord.tows || [],
      freights: historyRecord.freights || [],
      os_discount_pct: historyRecord.osDiscountPct || 0,
      total_value: historyRecord.totalValue || 0,
      photos: historyRecord.photos || [],
    };
    ({ data: hData, error: hErr } = await supabase.from("os_history").insert(insertPayload).select("id").single());
    // If photos column doesn't exist yet, retry without it
    if (hErr && hErr.message && hErr.message.includes("photos")) {
      const { photos: _, ...payloadWithoutPhotos } = insertPayload;
      ({ data: hData, error: hErr } = await supabase.from("os_history").insert(payloadWithoutPhotos).select("id").single());
    }
    if (hErr) throw hErr;

    const osHistoryId = hData.id;

    // 2) Migrate existing vehicle payments to this OS history
    await supabase.from("payments")
      .update({ os_history_id: osHistoryId })
      .eq("vehicle_id", vehicleId)
      .is("os_history_id", null);

    // 3) Delete all current tasks for this vehicle
    await supabase.from("tasks").delete().eq("vehicle_id", vehicleId).eq("division", "performance");

    // 3) Reset vehicle: clear timers, os_number, status — keep model/plate/client/mechanics
    const { error: vErr } = await supabase.from("vehicles").update({
      entered_at: null,
      paused_at: null,
      total_paused_ms: 0,
      status: "active",
      os_number: null,
      priority: "medium",
      sort_order: 0,
      fuel_cost: 0,
      fuels: [],
      checklist: [],
      parts_list: [],
      photos: [],
      os_discount_pct: 0,
      tows: [],
      notes: '',
    }).eq("id", vehicleId);
    if (vErr) throw vErr;
  },

  async archiveAndResetVehicleFinishing(vehicleId, historyRecord) {
    // 1) Save Finishing OS snapshot to os_history with division="finishing"
    let hData, hErr;
    const insertPayload = {
      vehicle_id: vehicleId,
      os_number: historyRecord.osNumber,
      client_id: historyRecord.clientId,
      mechanic_ids: historyRecord.mechanicIds,
      entered_at: historyRecord.enteredAt,
      delivered_at: historyRecord.deliveredAt,
      total_paused_ms: historyRecord.totalPausedMs || 0,
      tasks_snapshot: historyRecord.tasksSnapshot,
      fuel_cost: 0,
      fuels: [],
      tows: [],
      os_discount_pct: historyRecord.osDiscountPct || 0,
      total_value: historyRecord.totalValue || 0,
      division: "finishing",
      photos: historyRecord.photos || [],
    };
    ({ data: hData, error: hErr } = await supabase.from("os_history").insert(insertPayload).select("id").single());
    if (hErr && hErr.message && hErr.message.includes("photos")) {
      const { photos: _, ...payloadWithoutPhotos } = insertPayload;
      ({ data: hData, error: hErr } = await supabase.from("os_history").insert(payloadWithoutPhotos).select("id").single());
    }
    if (hErr) throw hErr;

    const osHistoryId = hData.id;

    // 2) Migrate finishing payments to this OS history
    await supabase.from("payments")
      .update({ os_history_id: osHistoryId })
      .eq("vehicle_id", vehicleId)
      .eq("division", "finishing")
      .is("os_history_id", null);

    // 3) Delete finishing tasks for this vehicle
    await supabase.from("tasks").delete().eq("vehicle_id", vehicleId).eq("division", "finishing");

    // 4) Reset finishing fields on vehicle
    const { error: vErr } = await supabase.from("vehicles").update({
      os_number_finishing: null,
      entered_at_finishing: null,
      status_finishing: "active",
      paused_at_finishing: null,
      total_paused_ms_finishing: 0,
      photos_finishing: [],
      notes_finishing: "",
      checklist_finishing: [],
      parts_list_finishing: [],
      os_discount_pct_finishing: 0,
    }).eq("id", vehicleId);
    if (vErr) throw vErr;
  },

  // Tasks
  async addTask(t) {
    const { data, error } = await supabase.from("tasks").insert(mapTaskOut(t)).select().single();
    if (error) throw error;
    return mapTaskIn(data);
  },
  async updateTask(id, patch) {
    const dbPatch = {};
    const map = { vehicleId:"vehicle_id", label:"label", done:"done", materials:"materials", hours:"hours", ratePerHour:"rate_per_hour", completedAt:"completed_at", completedByEmployeeId:"completed_by_employee_id", outsourced:"outsourced", warranty:"warranty", discount:"discount", category:"category", description:"description", rateType:"rate_type", division:"division", updates:"updates" };
    Object.keys(patch).forEach((k) => { if (map[k]) dbPatch[map[k]] = patch[k]; });
    const { error } = await supabase.from("tasks").update(dbPatch).eq("id", id);
    if (error) throw error;
  },
  async deleteTask(id) {
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) throw error;
  },

  // Stock
  async addStock(s) {
    const { data, error } = await supabase.from("stock").insert(mapStockOut(s)).select().single();
    if (error) throw error;
    return mapStockIn(data);
  },
  async updateStock(id, patch) {
    const dbPatch = {};
    const map = { name:"name", brand:"brand", type:"type", qty:"qty", costPrice:"cost_price", markup:"markup", salePrice:"sale_price", photo:"photo", location:"location", minQty:"min_qty", orderLink:"order_link" };
    Object.keys(patch).forEach((k) => { if (map[k]) dbPatch[map[k]] = patch[k]; });
    const { error } = await supabase.from("stock").update(dbPatch).eq("id", id);
    if (error) throw error;
  },
  async deleteStock(id) {
    const { error } = await supabase.from("stock").delete().eq("id", id);
    if (error) throw error;
  },

  // Stock purchases (immutable history once created)
  async addPurchase(p) {
    const { data, error } = await supabase.from("stock_purchases").insert({
      stock_id: p.stockId,
      purchase_date: p.purchaseDate,
      supplier: p.supplier,
      qty: p.qty,
      unit_cost: p.unitCost,
      total_cost: p.totalCost,
      invoice_number: p.invoiceNumber,
    }).select().single();
    if (error) throw error;
    return mapPurchaseIn(data);
  },
  async updatePurchase(id, patch) {
    const dbPatch = {};
    const map = { purchaseDate:"purchase_date", supplier:"supplier", qty:"qty", unitCost:"unit_cost", totalCost:"total_cost", invoiceNumber:"invoice_number" };
    Object.keys(patch).forEach((k) => { if (map[k]) dbPatch[map[k]] = patch[k]; });
    const { error } = await supabase.from("stock_purchases").update(dbPatch).eq("id", id);
    if (error) throw error;
  },
  async deletePurchase(id) {
    const { error } = await supabase.from("stock_purchases").delete().eq("id", id);
    if (error) throw error;
  },

  // Settings
  async setDefaultRate(rate) {
    const { error } = await supabase.from("settings").update({ default_rate: rate }).eq("id", 1);
    if (error) throw error;
  },
  async setCompanyInfo(info) {
    const { error } = await supabase.from("settings").update({
      company_name: info.name,
      company_address: info.address,
      company_phone: info.phone,
      company_document: info.document,
    }).eq("id", 1);
    if (error) throw error;
  },

  // Payments
  async addPayment(p) {
    const { data, error } = await supabase.from("payments").insert({
      vehicle_id: p.vehicleId,
      os_history_id: p.osHistoryId || null,
      amount: p.amount,
      method: p.method,
      paid_at: p.paidAt,
      note: p.note || "",
      division: p.division || "performance",
    }).select().single();
    if (error) throw error;
    return mapPaymentIn(data);
  },
  async deletePayment(id) {
    const { error } = await supabase.from("payments").delete().eq("id", id);
    if (error) throw error;
  },
  async updatePayment(id, patch) {
    const map = {};
    if (patch.amount   !== undefined) map.amount    = patch.amount;
    if (patch.method   !== undefined) map.method    = patch.method;
    if (patch.note     !== undefined) map.note      = patch.note;
    if (patch.paidAt   !== undefined) map.paid_at   = patch.paidAt;
    if (patch.division !== undefined) map.division  = patch.division;
    const { error } = await supabase.from("payments").update(map).eq("id", id);
    if (error) throw error;
  },
  // Migrate existing vehicle payments to a specific OS history record
  async migratePaymentsToHistory(vehicleId, osHistoryId) {
    const { error } = await supabase.from("payments")
      .update({ os_history_id: osHistoryId })
      .eq("vehicle_id", vehicleId)
      .is("os_history_id", null);
    if (error) throw error;
  },

  // ── Push Notifications ────────────────────────────────────────────────────
  async savePushSubscription(employeeId, subscription) {
    const { error } = await supabase.from("push_subscriptions").upsert({
      employee_id: employeeId,
      endpoint: subscription.endpoint,
      p256dh: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey("p256dh")))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,""),
      auth: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey("auth")))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,""),
    }, { onConflict: "endpoint" });
    if (error) throw error;
  },

  async saveAdminPushSubscription(role, subscription) {
    const { error } = await supabase.from("admin_push_subscriptions").upsert({
      role,
      endpoint: subscription.endpoint,
      p256dh: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey("p256dh")))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,""),
      auth: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey("auth")))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,""),
    }, { onConflict: "endpoint" });
    if (error) throw error;
  },

  async sendPushToAdmins(title, body, url) {
    const { error } = await supabase.functions.invoke("send-push", {
      body: { adminAll: true, title, body, url },
    });
    if (error) console.warn("Admin push error:", error);
  },

  async saveClientPushSubscription(clientId, subscription) {
    const { error } = await supabase.from("client_push_subscriptions").upsert({
      client_id: clientId,
      endpoint: subscription.endpoint,
      p256dh: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey("p256dh")))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,""),
      auth: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey("auth")))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,""),
    }, { onConflict: "endpoint" });
    if (error) throw error;
  },

  async sendPushToClient(clientId, title, body, url) {
    const { error } = await supabase.functions.invoke("send-push", {
      body: { clientId, title, body, url },
    });
    if (error) console.warn("Client push error:", error);
  },

  async loadAllClientVehicleNotes() {
    const { data, error } = await supabase.from("client_vehicle_notes")
      .select("*").eq("resolved", false).order("created_at", { ascending: false });
    if (error) throw error;
    return (data||[]).map(n=>({id:n.id,vehicleId:n.vehicle_id,clientId:n.client_id,note:n.note,createdAt:n.created_at}));
  },

  async getClientVehicleNotes(vehicleId) {
    const { data, error } = await supabase.from("client_vehicle_notes")
      .select("*").eq("vehicle_id", vehicleId).order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async addClientVehicleNote(vehicleId, clientId, note) {
    const { data, error } = await supabase.from("client_vehicle_notes")
      .insert({ vehicle_id: vehicleId, client_id: clientId, note })
      .select().single();
    if (error) throw error;
    return data;
  },

  async deleteClientVehicleNote(id) {
    const { error } = await supabase.from("client_vehicle_notes").delete().eq("id", id);
    if (error) throw error;
  },

  async resolveClientVehicleNote(id) {
    const { error } = await supabase.from("client_vehicle_notes")
      .update({ resolved: true, resolved_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
  },

  async removePushSubscription(endpoint) {
    const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    if (error) throw error;
  },

  async sendPushToEmployee(employeeId, title, body, url) {
    const { error } = await supabase.functions.invoke("send-push", {
      body: { employeeId, title, body, url },
    });
    if (error) console.warn("Push send error:", error);
  },

  // ── Purchase Orders ───────────────────────────────────────────────────────
  _mapOrder(o) {
    return {
      id: o.id,
      vehicleId: o.vehicle_id,
      employeeId: o.employee_id,
      taskId: o.task_id,
      partName: o.part_name,
      description: o.description||"",
      photoUrl: o.photo_url||"",
      quantity: o.quantity||1,
      link: o.link||"",
      costPrice: o.cost_price!=null?Number(o.cost_price):null,
      markupPct: o.markup_pct!=null?Number(o.markup_pct):30,
      notesAdmin: o.notes_admin||"",
      status: o.status||"pending",
      createdAt: o.created_at,
      readyAt: o.ready_at,
      boughtAt: o.bought_at,
      receivedAt: o.received_at,
    };
  },
  async loadPurchaseOrders() {
    const { data, error } = await supabase.from("purchase_orders")
      .select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return (data||[]).map(o=>this._mapOrder(o));
  },
  async addPurchaseOrder(p) {
    const { data, error } = await supabase.from("purchase_orders").insert({
      vehicle_id: p.vehicleId,
      employee_id: p.employeeId||null,
      task_id: p.taskId||null,
      part_name: p.partName,
      description: p.description||"",
      photo_url: p.photoUrl||"",
      quantity: p.quantity||1,
      status: "pending",
    }).select().single();
    if (error) throw error;
    return this._mapOrder(data);
  },
  async updatePurchaseOrder(id, patch) {
    const map = {};
    if(patch.link!==undefined) map.link=patch.link;
    if(patch.costPrice!==undefined) map.cost_price=patch.costPrice;
    if(patch.brand!==undefined) map.notes_admin=patch.brand; // reuse notes_admin for brand
    if(patch.notesAdmin!==undefined) map.notes_admin=patch.notesAdmin;
    if(patch.quantity!==undefined) map.quantity=patch.quantity;
    if(patch.status!==undefined) {
      map.status=patch.status;
      if(patch.status==="ready_to_buy") map.ready_at=new Date().toISOString();
      if(patch.status==="bought") map.bought_at=new Date().toISOString();
      if(patch.status==="received") map.received_at=new Date().toISOString();
    }
    const { data, error } = await supabase.from("purchase_orders")
      .update(map).eq("id", id).select().single();
    if (error) throw error;
    return this._mapOrder(data);
  },
  async deletePurchaseOrder(id) {
    const { error } = await supabase.from("purchase_orders").delete().eq("id", id);
    if (error) throw error;
  },

  // ── Investments ───────────────────────────────────────────────────────────
  _mapInvestment(i) {
    return {
      id: i.id, name: i.name, link: i.link||"", value: Number(i.value||0),
      quantity: i.quantity||1, objective: i.objective||"",
      division: i.division||"performance", category: i.category||"leve",
      priority: i.priority||3, status: i.status||"pending",
      createdBy: i.created_by||"", createdAt: i.created_at,
      receivedAt: i.received_at||null,
      stockItemId: i.stock_item_id||null,
    };
  },
  async loadInvestments() {
    const { data, error } = await supabase.from("investments")
      .select("*").order("priority").order("created_at");
    if (error) throw error;
    return (data||[]).map(i=>this._mapInvestment(i));
  },
  async addInvestment(inv) {
    const { data, error } = await supabase.from("investments").insert({
      name: inv.name, link: inv.link||"", value: inv.value||0,
      quantity: inv.quantity||1, objective: inv.objective||"",
      division: inv.division||"performance", category: inv.category||"leve",
      priority: inv.priority||3, status: "pending", created_by: inv.createdBy||"",
      stock_item_id: inv.stockItemId||null,
    }).select().single();
    if (error) throw error;
    return this._mapInvestment(data);
  },
  async updateInvestment(id, patch) {
    const map = {};
    if(patch.name!==undefined) map.name=patch.name;
    if(patch.link!==undefined) map.link=patch.link;
    if(patch.value!==undefined) map.value=patch.value;
    if(patch.quantity!==undefined) map.quantity=patch.quantity;
    if(patch.objective!==undefined) map.objective=patch.objective;
    if(patch.division!==undefined) map.division=patch.division;
    if(patch.category!==undefined) map.category=patch.category;
    if(patch.priority!==undefined) map.priority=patch.priority;
    if(patch.status!==undefined) map.status=patch.status;
    if(patch.status==="received") map.received_at=new Date().toISOString();
    const { data, error } = await supabase.from("investments").update(map).eq("id",id).select().single();
    if (error) throw error;
    return this._mapInvestment(data);
  },
  async deleteInvestment(id) {
    const { error } = await supabase.from("investments").delete().eq("id", id);
    if (error) throw error;
  },

  // ── Expenses ──────────────────────────────────────────────────────────────
  async loadExpenses() {
    const { data, error } = await supabase.from("expenses").select("*").order("category").order("name");
    if (error) throw error;
    return (data || []).map(e=>({
      id: e.id, name: e.name, amount: Number(e.amount), category: e.category,
      recurrent: e.recurrent, division: e.division, createdAt: e.created_at,
    }));
  },
  async addExpense(exp) {
    const { data, error } = await supabase.from("expenses").insert({
      name: exp.name, amount: exp.amount, category: exp.category||"outros",
      recurrent: exp.recurrent!==false, division: exp.division||"ambos",
    }).select().single();
    if (error) throw error;
    return { id:data.id, name:data.name, amount:Number(data.amount), category:data.category, recurrent:data.recurrent, division:data.division, createdAt:data.created_at };
  },
  async updateExpense(id, patch) {
    const { error } = await supabase.from("expenses").update({
      name: patch.name, amount: patch.amount, category: patch.category,
      recurrent: patch.recurrent, division: patch.division,
    }).eq("id", id);
    if (error) throw error;
  },
  async deleteExpense(id) {
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) throw error;
  },

  // ── Sales / Shelf ──────────────────────────────────────────────────────────
  async getShelfItems() {
    const { data, error } = await supabase.from("shelf_items").select("*").eq("active", true).order("name");
    if (error) throw error;
    return data || [];
  },
  async addShelfItem(item) {
    const { data, error } = await supabase.from("shelf_items").insert([item]).select().single();
    if (error) throw error;
    return data;
  },
  async updateShelfItem(id, patch) {
    const { data, error } = await supabase.from("shelf_items").update(patch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },
  async deleteShelfItem(id) {
    const { error } = await supabase.from("shelf_items").update({ active: false }).eq("id", id);
    if (error) throw error;
  },
  async getSales() {
    const { data, error } = await supabase.from("sales").select("*, sale_items(*)").order("sold_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async addSale(sale, items) {
    const { data: saleRow, error: saleErr } = await supabase.from("sales").insert([sale]).select().single();
    if (saleErr) throw saleErr;
    if (items?.length) {
      const rows = items.map(i => ({ ...i, sale_id: saleRow.id }));
      const { error: itemErr } = await supabase.from("sale_items").insert(rows);
      if (itemErr) throw itemErr;
    }
    return { ...saleRow, sale_items: items?.map(i => ({ ...i, sale_id: saleRow.id })) || [] };
  },
  async deleteSale(id) {
    const { error } = await supabase.from("sales").delete().eq("id", id);
    if (error) throw error;
  },

  // ── Internal Transfers ──────────────────────────────────────────────────────
  async loadInternalTransfers() {
    const { data, error } = await supabase.from("internal_transfers").select("*").order("date",{ascending:false});
    if (error) throw error;
    return data || [];
  },
  async addInternalTransfer(t) {
    const { data, error } = await supabase.from("internal_transfers").insert({
      vehicle_id:    t.vehicleId   || null,
      os_number:     t.osNumber    || null,
      division_from: t.divisionFrom,
      division_to:   t.divisionTo,
      amount:        t.amount,
      reason:        t.reason      || "",
      date:          t.date        || new Date().toISOString().slice(0,10),
    }).select().single();
    if (error) throw error;
    return data;
  },
  async deleteInternalTransfer(id) {
    const { error } = await supabase.from("internal_transfers").delete().eq("id", id);
    if (error) throw error;
  },

  // ── Appointments ─────────────────────────────────────────────────────────────
  async loadAppointments() {
    const [apt,svc,pay]=await Promise.all([
      supabase.from("appointments").select("*").order("created_at",{ascending:false}),
      supabase.from("appointment_services").select("*").order("created_at"),
      supabase.from("appointment_payments").select("*").order("paid_at"),
    ]);
    if(apt.error) throw apt.error;
    return (apt.data||[]).map(a=>({
      id:a.id, vehicleId:a.vehicle_id, clientId:a.client_id,
      status:a.status, notes:a.notes||"", createdAt:a.created_at,
      services:(svc.data||[]).filter(s=>s.appointment_id===a.id).map(s=>({
        id:s.id, appointmentId:s.appointment_id, label:s.label,
        category:s.category||null, division:s.division||"performance",
        estimatedValue:Number(s.estimated_value||0), notes:s.notes||"",
      })),
      payments:(pay.data||[]).filter(p=>p.appointment_id===a.id).map(p=>({
        id:p.id, appointmentId:p.appointment_id, amount:Number(p.amount),
        method:p.method, note:p.note||"", paidAt:p.paid_at,
      })),
    }));
  },
  async addAppointment(a) {
    const {data,error}=await supabase.from("appointments").insert({
      vehicle_id:a.vehicleId, client_id:a.clientId||null,
      status:"open", notes:a.notes||"",
    }).select().single();
    if(error) throw error;
    return {...data,vehicleId:data.vehicle_id,clientId:data.client_id,createdAt:data.created_at,services:[],payments:[]};
  },
  async updateAppointment(id,patch) {
    const map={notes:"notes",status:"status"};
    const dbp={};
    Object.keys(patch).forEach(k=>{if(map[k])dbp[map[k]]=patch[k];});
    dbp.updated_at=new Date().toISOString();
    const {error}=await supabase.from("appointments").update(dbp).eq("id",id);
    if(error) throw error;
  },
  async deleteAppointment(id) {
    const {error}=await supabase.from("appointments").delete().eq("id",id);
    if(error) throw error;
  },
  async addAppointmentService(s) {
    const {data,error}=await supabase.from("appointment_services").insert({
      appointment_id:s.appointmentId, label:s.label, category:s.category||null,
      division:s.division||"performance", estimated_value:s.estimatedValue||0, notes:s.notes||"",
    }).select().single();
    if(error) throw error;
    return {id:data.id,appointmentId:data.appointment_id,label:data.label,category:data.category,division:data.division,estimatedValue:Number(data.estimated_value),notes:data.notes||""};
  },
  async updateAppointmentService(id,patch) {
    const map={label:"label",category:"category",division:"division",estimatedValue:"estimated_value",notes:"notes"};
    const dbp={};
    Object.keys(patch).forEach(k=>{if(map[k])dbp[map[k]]=patch[k];});
    const {error}=await supabase.from("appointment_services").update(dbp).eq("id",id);
    if(error) throw error;
  },
  async deleteAppointmentService(id) {
    const {error}=await supabase.from("appointment_services").delete().eq("id",id);
    if(error) throw error;
  },
  async addAppointmentPayment(p) {
    const {data,error}=await supabase.from("appointment_payments").insert({
      appointment_id:p.appointmentId, amount:p.amount, method:p.method||"Pix",
      note:p.note||"", paid_at:p.paidAt||new Date().toISOString(),
    }).select().single();
    if(error) throw error;
    return {id:data.id,appointmentId:data.appointment_id,amount:Number(data.amount),method:data.method,note:data.note||"",paidAt:data.paid_at};
  },
  async deleteAppointmentPayment(id) {
    const {error}=await supabase.from("appointment_payments").delete().eq("id",id);
    if(error) throw error;
  },

  // ── Appointments ────────────────────────────────────────────────────────────
  async loadAppointments() {
    const [appt,svcs,pays] = await Promise.all([
      supabase.from("appointments").select("*").order("created_at",{ascending:false}),
      supabase.from("appointment_services").select("*").order("created_at"),
      supabase.from("appointment_payments").select("*").order("paid_at"),
    ]);
    if(appt.error) throw appt.error;
    return (appt.data||[]).map(a=>({
      id:a.id, vehicleId:a.vehicle_id, clientId:a.client_id,
      title:a.title, notes:a.notes, status:a.status,
      estimatedValue:Number(a.estimated_value||0),
      scheduledDate:a.scheduled_date||null,
      createdAt:a.created_at, convertedAt:a.converted_at,
      services:(svcs.data||[]).filter(s=>s.appointment_id===a.id).map(s=>({
        id:s.id, appointmentId:s.appointment_id, label:s.label,
        estimatedValue:Number(s.estimated_value||0),
        division:s.division||"performance", done:s.done, createdAt:s.created_at,
        materials:s.materials||[], category:s.category||null,
        hours:Number(s.hours||0), rate:Number(s.rate||0),
      })),
      payments:(pays.data||[]).filter(p=>p.appointment_id===a.id).map(p=>({
        id:p.id, appointmentId:p.appointment_id, amount:Number(p.amount||0),
        method:p.method, note:p.note, paidAt:p.paid_at,
      })),
    }));
  },
  async addAppointment(a) {
    const {data,error}=await supabase.from("appointments").insert({
      vehicle_id:a.vehicleId||null, client_id:a.clientId||null,
      title:a.title||"", notes:a.notes||"",
      estimated_value:a.estimatedValue||0, status:"open",
      scheduled_date:a.scheduledDate||null,
    }).select().single();
    if(error) throw error;
    return {...data,vehicleId:data.vehicle_id,clientId:data.client_id,estimatedValue:Number(data.estimated_value||0),scheduledDate:data.scheduled_date||null,createdAt:data.created_at,convertedAt:null,services:[],payments:[]};
  },
  async updateAppointment(id,patch) {
    const map={title:"title",notes:"notes",status:"status",estimatedValue:"estimated_value",convertedAt:"converted_at",scheduledDate:"scheduled_date"};
    const dbp={};
    Object.keys(patch).forEach(k=>{if(map[k]) dbp[map[k]]=patch[k];});
    const {error}=await supabase.from("appointments").update(dbp).eq("id",id);
    if(error) throw error;
  },
  async deleteAppointment(id) {
    const {error}=await supabase.from("appointments").delete().eq("id",id);
    if(error) throw error;
  },
  async addAppointmentService(s) {
    const {data,error}=await supabase.from("appointment_services").insert({
      appointment_id:s.appointmentId, label:s.label, estimated_value:s.estimatedValue||0,
      division:s.division||"performance", done:false, materials:s.materials||[], category:s.category||null,
      hours:s.hours||0, rate:s.rate||0,
    }).select().single();
    if(error) throw error;
    return {id:data.id,appointmentId:data.appointment_id,label:data.label,estimatedValue:Number(data.estimated_value||0),division:data.division,done:data.done,createdAt:data.created_at,materials:data.materials||[],category:data.category||null,hours:Number(data.hours||0),rate:Number(data.rate||0)};
  },
  async updateAppointmentService(id,patch) {
    const dbp={label:patch.label,estimated_value:patch.estimatedValue,division:patch.division,done:patch.done};
    if(patch.materials!==undefined) dbp.materials=patch.materials;
    const {error}=await supabase.from("appointment_services").update(dbp).eq("id",id);
    if(error) throw error;
  },
  async deleteAppointmentService(id) {
    const {error}=await supabase.from("appointment_services").delete().eq("id",id);
    if(error) throw error;
  },
  async addAppointmentPayment(p) {
    const {data,error}=await supabase.from("appointment_payments").insert({
      appointment_id:p.appointmentId, amount:p.amount,
      method:p.method||"Pix", note:p.note||"",
      paid_at:p.paidAt||new Date().toISOString(),
    }).select().single();
    if(error) throw error;
    return {id:data.id,appointmentId:data.appointment_id,amount:Number(data.amount),method:data.method,note:data.note,paidAt:data.paid_at};
  },
  async deleteAppointmentPayment(id) {
    const {error}=await supabase.from("appointment_payments").delete().eq("id",id);
    if(error) throw error;
  },

  // ── Calendar Events ──────────────────────────────────────────────────────────
  async loadCalendarEvents() {
    const {data,error}=await supabase.from("calendar_events").select("*").order("date").order("time");
    if(error) throw error;
    return (data||[]).map(e=>({
      id:e.id, title:e.title, date:e.date, time:e.time||null,
      type:e.type||"manual", vehicleId:e.vehicle_id||null, clientId:e.client_id||null,
      color:e.color||null, notes:e.notes||"", createdAt:e.created_at,
    }));
  },
  async addCalendarEvent(e) {
    const {data,error}=await supabase.from("calendar_events").insert({
      title:e.title, date:e.date, time:e.time||null,
      type:e.type||"manual", vehicle_id:e.vehicleId||null, client_id:e.clientId||null,
      color:e.color||null, notes:e.notes||"",
    }).select().single();
    if(error) throw error;
    return {id:data.id,title:data.title,date:data.date,time:data.time,type:data.type,vehicleId:data.vehicle_id,clientId:data.client_id,color:data.color,notes:data.notes,createdAt:data.created_at};
  },
  async updateCalendarEvent(id,patch) {
    const map={title:"title",date:"date",time:"time",type:"type",vehicleId:"vehicle_id",clientId:"client_id",color:"color",notes:"notes"};
    const dbp={};Object.keys(patch).forEach(k=>{if(map[k])dbp[map[k]]=patch[k];});
    const {error}=await supabase.from("calendar_events").update(dbp).eq("id",id);
    if(error) throw error;
  },
  async deleteCalendarEvent(id) {
    const {error}=await supabase.from("calendar_events").delete().eq("id",id);
    if(error) throw error;
  },

  // ── Vehicle Timeline ─────────────────────────────────────────────────────────
  async loadTimeline(vehicleId) {
    const {data,error}=await supabase.from("vehicle_timeline")
      .select("*").eq("vehicle_id",vehicleId).order("created_at",{ascending:false}).limit(80);
    if(error) throw error;
    return (data||[]).map(e=>({
      id:e.id, vehicleId:e.vehicle_id, type:e.type, title:e.title,
      body:e.body||"", actor:e.actor||null, category:e.category||null,
      color:e.color||null, meta:e.meta||{}, createdAt:e.created_at,
    }));
  },
  async addTimelineEvent(e) {
    const {data,error}=await supabase.from("vehicle_timeline").insert({
      vehicle_id:e.vehicleId, type:e.type, title:e.title, body:e.body||"",
      actor:e.actor||null, category:e.category||null, color:e.color||null, meta:e.meta||{},
    }).select().single();
    if(error) throw error;
    return {id:data.id,vehicleId:data.vehicle_id,type:data.type,title:data.title,body:data.body||"",actor:data.actor||null,category:data.category||null,color:data.color||null,meta:data.meta||{},createdAt:data.created_at};
  },
  async deleteTimelineEvent(id) {
    const {error}=await supabase.from("vehicle_timeline").delete().eq("id",id);
    if(error) throw error;
  },

  // ── Vehicle Timeline ─────────────────────────────────────────────────────────
  async loadTimeline(vehicleId) {
    const {data,error}=await supabase.from("vehicle_timeline")
      .select("*").eq("vehicle_id",vehicleId).order("created_at",{ascending:false}).limit(80);
    if(error) throw error;
    return (data||[]).map(e=>({
      id:e.id, vehicleId:e.vehicle_id, type:e.type, title:e.title,
      body:e.body||"", actor:e.actor||null, category:e.category||null,
      color:e.color||null, meta:e.meta||{}, createdAt:e.created_at,
    }));
  },
  async addTimelineEvent(e) {
    const {data,error}=await supabase.from("vehicle_timeline").insert({
      vehicle_id:e.vehicleId, type:e.type, title:e.title, body:e.body||"",
      actor:e.actor||null, category:e.category||null, color:e.color||null, meta:e.meta||{},
    }).select().single();
    if(error) throw error;
    return {id:data.id,vehicleId:data.vehicle_id,type:data.type,title:data.title,body:data.body||"",actor:data.actor||null,category:data.category||null,color:data.color||null,meta:data.meta||{},createdAt:data.created_at};
  },
  async deleteTimelineEvent(id) {
    const {error}=await supabase.from("vehicle_timeline").delete().eq("id",id);
    if(error) throw error;
  },

  async deleteOsHistory(id) {
    const { error } = await supabase.from("os_history").delete().eq("id", id);
    if (error) throw error;
  },

  async deleteVehicle(id) {
    const { error } = await supabase.from("vehicles").delete().eq("id", id);
    if (error) throw error;
  },

  // ── Internal mappers exposed for Realtime ──
  _mapTask: mapTaskIn,
  _mapVehicle: mapVehicleIn,
  _mapPayment: mapPaymentIn,
  _mapStock: mapStockIn,
  _mapPurchaseOrder: (o) => ({
    id:o.id, vehicleId:o.vehicle_id, partName:o.part_name, notesAdmin:o.notes_admin||"",
    link:o.link||"", quantity:o.quantity||1, costPrice:Number(o.cost_price||0),
    status:o.status||"pending", employeeId:o.employee_id, createdAt:o.created_at,
    receivedAt:o.received_at||null, receivedLocation:o.received_location||"",
  }),
  _mapEmployee: (e) => e,
};
