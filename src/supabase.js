import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://lchfmoeyzgbepunetuch.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjaGZtb2V5emdiZXB1bmV0dWNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NzEzOTUsImV4cCI6MjA5ODM0NzM5NX0.2RTbc1Dd_VWGT56ak1T41HH2zGXCS6MDbnXe4EY3SYQ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
  fuelCost: Number(v.fuel_cost || 0),
  fuels: Array.isArray(v.fuels) ? v.fuels : (v.fuels ? JSON.parse(v.fuels) : []),
  osDiscountPct: Number(v.os_discount_pct || 0),
  tows: Array.isArray(v.tows) ? v.tows : (v.tows ? JSON.parse(v.tows) : []),
  notes: v.notes || '',
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
  discount: Number(t.discount || 0),
  category: t.category || null,
  description: t.description || '',
  rateType: t.rate_type || 'hour',
});
const mapTaskOut = (t) => ({
  vehicle_id: t.vehicleId,
  label: t.label,
  done: t.done,
  materials: t.materials || [],
  hours: t.hours,
  rate_per_hour: t.ratePerHour,
  completed_at: t.completedAt || null,
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
  async addEmployee(name, phone) {
    const { data, error } = await supabase.from("employees").insert({ name, phone }).select().single();
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

  async updateVehicle(id, patch) {
    const dbPatch = {};
    if ("employeeId"    in patch) dbPatch.employee_id    = patch.employeeId;
    if ("clientId"      in patch) dbPatch.client_id      = patch.clientId;
    if ("model"         in patch) dbPatch.model          = patch.model;
    if ("plate"         in patch) dbPatch.plate          = patch.plate;
    if ("color"         in patch) dbPatch.color          = patch.color;
    if ("year"          in patch) dbPatch.year           = patch.year;
    if ("photo"         in patch) dbPatch.photo          = patch.photo;
    if ("photos"        in patch) dbPatch.photos         = patch.photos;
    if ("enteredAt"   in patch) dbPatch.entered_at   = patch.enteredAt;
    if ("deliveredAt" in patch) dbPatch.delivered_at = patch.deliveredAt;
    if ("status"      in patch) dbPatch.status       = patch.status;
    if ("priority"    in patch) dbPatch.priority     = patch.priority;
    if ("fuelCost"       in patch) dbPatch.fuel_cost       = patch.fuelCost;
    if ("fuels"          in patch) dbPatch.fuels          = patch.fuels;
    if ("osDiscountPct"  in patch) dbPatch.os_discount_pct = patch.osDiscountPct;
    if ("tows"           in patch) dbPatch.tows            = patch.tows;
    if ("notes"          in patch) dbPatch.notes           = patch.notes;
    if ("pausedAt"      in patch) dbPatch.paused_at      = patch.pausedAt;
    if ("totalPausedMs" in patch) dbPatch.total_paused_ms= patch.totalPausedMs;
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
    // 1) Save OS snapshot to os_history
    const { data: hData, error: hErr } = await supabase.from("os_history").insert({
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
      os_discount_pct: historyRecord.osDiscountPct || 0,
      total_value: historyRecord.totalValue || 0,
    }).select("id").single();
    if (hErr) throw hErr;

    const osHistoryId = hData.id;

    // 2) Migrate existing vehicle payments to this OS history
    await supabase.from("payments")
      .update({ os_history_id: osHistoryId })
      .eq("vehicle_id", vehicleId)
      .is("os_history_id", null);

    // 3) Delete all current tasks for this vehicle
    await supabase.from("tasks").delete().eq("vehicle_id", vehicleId);

    // 3) Reset vehicle: clear timers, os_number, status — keep model/plate/client/mechanics
    const { error: vErr } = await supabase.from("vehicles").update({
      entered_at: null,
      paused_at: null,
      total_paused_ms: 0,
      status: "active",
      os_number: null,
      priority: "medium",
      fuel_cost: 0,
      fuels: [],
      os_discount_pct: 0,
      tows: [],
      notes: '',
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
    const map = { vehicleId:"vehicle_id", label:"label", done:"done", materials:"materials", hours:"hours", ratePerHour:"rate_per_hour", completedAt:"completed_at", completedByEmployeeId:"completed_by_employee_id", outsourced:"outsourced", discount:"discount", category:"category", description:"description", rateType:"rate_type" };
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
    const map = { name:"name", brand:"brand", type:"type", qty:"qty", costPrice:"cost_price", markup:"markup", salePrice:"sale_price", photo:"photo", location:"location", minQty:"min_qty" };
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
    }).select().single();
    if (error) throw error;
    return mapPaymentIn(data);
  },
  async deletePayment(id) {
    const { error } = await supabase.from("payments").delete().eq("id", id);
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
};
