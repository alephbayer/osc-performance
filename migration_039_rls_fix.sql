-- Migration 039 — Fix RLS policies
-- Restricts all tables to anon role only (app-level auth)

-- ── shelf_items ──────────────────────────────────────────────
DROP POLICY IF EXISTS "shelf_items_all" ON shelf_items;
DROP POLICY IF EXISTS "shelf_items_anon" ON shelf_items;
CREATE POLICY "shelf_items_anon" ON shelf_items FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── sales ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "sales_all" ON sales;
DROP POLICY IF EXISTS "sales_anon" ON sales;
CREATE POLICY "sales_anon" ON sales FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── sale_items ───────────────────────────────────────────────
DROP POLICY IF EXISTS "sale_items_all" ON sale_items;
DROP POLICY IF EXISTS "sale_items_anon" ON sale_items;
CREATE POLICY "sale_items_anon" ON sale_items FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── Ensure RLS is enabled on all core tables ─────────────────
ALTER TABLE clients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees         ENABLE ROW LEVEL SECURITY;
ALTER TABLE os_history        ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders   ENABLE ROW LEVEL SECURITY;
ALTER TABLE investments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock             ENABLE ROW LEVEL SECURITY;
ALTER TABLE shelf_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items        ENABLE ROW LEVEL SECURITY;

-- ── clients ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "anyone can manage clients" ON clients;
DROP POLICY IF EXISTS "clients_all" ON clients;
DROP POLICY IF EXISTS "clients_anon" ON clients;
CREATE POLICY "clients_anon" ON clients FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── vehicles ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "anyone can manage vehicles" ON vehicles;
DROP POLICY IF EXISTS "vehicles_all" ON vehicles;
DROP POLICY IF EXISTS "vehicles_anon" ON vehicles;
CREATE POLICY "vehicles_anon" ON vehicles FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── tasks ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "anyone can manage tasks" ON tasks;
DROP POLICY IF EXISTS "tasks_all" ON tasks;
DROP POLICY IF EXISTS "tasks_anon" ON tasks;
CREATE POLICY "tasks_anon" ON tasks FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── payments ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "anyone can manage payments" ON payments;
DROP POLICY IF EXISTS "payments_all" ON payments;
DROP POLICY IF EXISTS "payments_anon" ON payments;
CREATE POLICY "payments_anon" ON payments FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── employees ────────────────────────────────────────────────
DROP POLICY IF EXISTS "anyone can manage employees" ON employees;
DROP POLICY IF EXISTS "employees_all" ON employees;
DROP POLICY IF EXISTS "employees_anon" ON employees;
CREATE POLICY "employees_anon" ON employees FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── os_history ───────────────────────────────────────────────
DROP POLICY IF EXISTS "anyone can manage os_history" ON os_history;
DROP POLICY IF EXISTS "os_history_all" ON os_history;
DROP POLICY IF EXISTS "os_history_anon" ON os_history;
CREATE POLICY "os_history_anon" ON os_history FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── expenses ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "anyone can manage expenses" ON expenses;
DROP POLICY IF EXISTS "expenses_all" ON expenses;
DROP POLICY IF EXISTS "expenses_anon" ON expenses;
CREATE POLICY "expenses_anon" ON expenses FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── purchase_orders ──────────────────────────────────────────
DROP POLICY IF EXISTS "anyone can manage purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "purchase_orders_all" ON purchase_orders;
DROP POLICY IF EXISTS "purchase_orders_anon" ON purchase_orders;
CREATE POLICY "purchase_orders_anon" ON purchase_orders FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── investments ──────────────────────────────────────────────
DROP POLICY IF EXISTS "anyone can manage investments" ON investments;
DROP POLICY IF EXISTS "investments_all" ON investments;
DROP POLICY IF EXISTS "investments_anon" ON investments;
CREATE POLICY "investments_anon" ON investments FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── stock ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "anyone can manage stock" ON stock;
DROP POLICY IF EXISTS "stock_all" ON stock;
DROP POLICY IF EXISTS "stock_anon" ON stock;
CREATE POLICY "stock_anon" ON stock FOR ALL TO anon USING (true) WITH CHECK (true);
