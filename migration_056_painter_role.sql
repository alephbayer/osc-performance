-- applied via MCP: allow painter role in push subs
alter table admin_push_subscriptions drop constraint admin_push_subscriptions_role_check;
alter table admin_push_subscriptions add constraint admin_push_subscriptions_role_check check (role in ('owner','admin','supervisor','painter'));
