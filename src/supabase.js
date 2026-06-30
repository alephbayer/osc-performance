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
  employeeId: v.employee_id,
  clientId: v.client_id,
  model: v.model,
  plate: v.plate,
  photo: v.photo,
  photos: v.photos || [],
});
const mapVehicleOut = (v) => ({
  employee_id: v.employeeId,
  client_id: v.clientId,
  model: v.model,
  plate: v.plate,
  photo: v.photo,
  photos: v.photos,
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
});

const mapPaymentIn = (p) => ({
  id: p.id,
  vehicleId: p.vehicle_id,
  amount: Number(p.amount),
  method: p.method,
  paidAt: p.paid_at,
  note: p.note,
});

// ─── Data API ─────────────────────────────────────────────────────────────────
export const db = {
  // Load everything at once
  async loadAll() {
    const [emp, cli, veh, tsk, stk, set, pay] = await Promise.all([
      supabase.from("employees").select("*").order("created_at"),
      supabase.from("clients").select("*").order("created_at"),
      supabase.from("vehicles").select("*").order("created_at"),
      supabase.from("tasks").select("*").order("created_at"),
      supabase.from("stock").select("*").order("created_at"),
      supabase.from("settings").select("*").eq("id", 1).single(),
      supabase.from("payments").select("*").order("paid_at"),
    ]);
    return {
      employees: emp.data || [],
      clients: cli.data || [],
      vehicles: (veh.data || []).map(mapVehicleIn),
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
  async addClient(name, phone) {
    const { data, error } = await supabase.from("clients").insert({ name, phone }).select().single();
    if (error) throw error;
    return data;
  },
  async updateClient(id, patch) {
    const { error } = await supabase.from("clients").update(patch).eq("id", id);
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
  async updateVehicle(id, patch) {
    const dbPatch = {};
    if ("employeeId" in patch) dbPatch.employee_id = patch.employeeId;
    if ("clientId" in patch) dbPatch.client_id = patch.clientId;
    if ("model" in patch) dbPatch.model = patch.model;
    if ("plate" in patch) dbPatch.plate = patch.plate;
    if ("photo" in patch) dbPatch.photo = patch.photo;
    if ("photos" in patch) dbPatch.photos = patch.photos;
    const { error } = await supabase.from("vehicles").update(dbPatch).eq("id", id);
    if (error) throw error;
  },
  async deleteVehicle(id) {
    const { error } = await supabase.from("vehicles").delete().eq("id", id);
    if (error) throw error;
  },

  // Tasks
  async addTask(t) {
    const { data, error } = await supabase.from("tasks").insert(mapTaskOut(t)).select().single();
    if (error) throw error;
    return mapTaskIn(data);
  },
  async updateTask(id, patch) {
    const dbPatch = {};
    const map = { vehicleId:"vehicle_id", label:"label", done:"done", materials:"materials", hours:"hours", ratePerHour:"rate_per_hour", completedAt:"completed_at" };
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
    const map = { name:"name", brand:"brand", type:"type", qty:"qty", costPrice:"cost_price", markup:"markup", salePrice:"sale_price", photo:"photo" };
    Object.keys(patch).forEach((k) => { if (map[k]) dbPatch[map[k]] = patch[k]; });
    const { error } = await supabase.from("stock").update(dbPatch).eq("id", id);
    if (error) throw error;
  },
  async deleteStock(id) {
    const { error } = await supabase.from("stock").delete().eq("id", id);
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
      vehicle_id: p.vehicleId, amount: p.amount, method: p.method, paid_at: p.paidAt, note: p.note || "",
    }).select().single();
    if (error) throw error;
    return mapPaymentIn(data);
  },
  async deletePayment(id) {
    const { error } = await supabase.from("payments").delete().eq("id", id);
    if (error) throw error;
  },
};
