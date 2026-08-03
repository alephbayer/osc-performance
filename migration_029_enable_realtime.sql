-- Migration 029: Enable Supabase Realtime on key tables
-- Run in Supabase SQL Editor

-- Enable realtime for the tables that need live updates
alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table vehicles;
alter publication supabase_realtime add table payments;
alter publication supabase_realtime add table employees;
alter publication supabase_realtime add table stock;
