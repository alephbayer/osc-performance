# Pendências do sistema OSC

Lista viva do que ficou em aberto. **Leia no início de cada sessão e atualize ao terminar** (marque feito, acrescente o que surgir). Assim nada depende da memória da conversa.

## Em andamento: levar o desenvolvimento para o Claude Code no Mac
- [x] Instalar o Claude Code no Mac e abrir `~/osc-performance` (feito em 2026-11-23)
- [ ] Conectar GitHub (poder dar push), Supabase e Vercel no Claude Code do Mac
- [x] Primeira tarefa de teste pequena, conferindo o fluxo do `CLAUDE.md` (remoção do `ClientCard`, v2026.11.23.196)
- [ ] Depois: criar a pasta de análise de orçamentos antigos, **fora** deste repositório (ele é público); sugestão `~/OSC/orcamentos` com `originais/`, `dados/`, `analises/`

## Para o Aleph validar
- [ ] Chefe de Pintura: entrar com a senha nova e conferir que só aparecem os carros da Finishing, sem nenhum valor
- [ ] Subir o backup (zip de `backup-AAAA-MM-DD/`) para o local privado e confirmar

## Funcionalidades combinadas, ainda não feitas
- [ ] Listar itens do Mercado Livre destinados automaticamente antes da v189 e ainda sem confirmação do administrador
- [ ] Validade da proposta em PDF (precisa o número de dias definido pelo Aleph)

## Limpeza técnica
- [x] Remover o código morto `ClientCard` em `App.jsx` (v2026.11.23.196)
- [x] Remover do Git a cópia antiga `src/App.jsx.bak` (v2026.11.23.197)
- [ ] `index.html`: o script que põe a classe `osc-app`/`osc-public` roda no `<head>`, antes do `body` existir, e dá erro no console (`Cannot read properties of null (reading 'classList')`); a classe pode não estar sendo aplicada
- [ ] Changelog: faltam as entradas entre 2026-08-19 e 2026-11-18 (`public/changelog.json`)

## Segurança (sem urgência, discutir antes de mexer)
- [ ] Repositório `alephbayer/osc-performance` está público no GitHub; avaliar deixar privado
- [ ] Muitas tabelas aceitam acesso pela chave pública (`anon`) com policy `using (true)`; correção real exige Supabase Auth (mudança grande)
- [ ] Backup mensal (ou antes de mudança grande no banco): `scripts/backup.mjs` e `scripts/schema.mjs`

## Pitstop (depois)
- [ ] A edge function `manual-ask` existe só no Supabase e o Pitstop (`manual-fueltech` no Vercel) não tem repositório; guardar o código em um repositório
