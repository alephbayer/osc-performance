// Harness de teste do PDF de orçamento (renderElegantQuote), sem abrir o app.
// Extrai a função direto de src/App.jsx e gera um PDF de exemplo (Challenger, serviço em "Ficha").
// Uso: npm i --no-save jspdf@2.5.1 && node scripts/pdf-test.cjs saida.pdf
// Variações: troque perf:true/false e divisionName ("OSC Group" / "OSC Finishing Division") nos dados abaixo.
// Cobrança parcial: node scripts/pdf-test.cjs saida.pdf parcial  (gera saida-perf.pdf e saida-fin.pdf)
// Depois: pdftoppm -r 70 -png saida.pdf pag   (e olhe cada página)
const {jsPDF}=require('jspdf');
const isInternalTask=t=>false;
const loadJsPDF=async()=>jsPDF; 
const fmtD=()=>"13/11/2026"; const fmtOS=n=>"OS-"+String(n).padStart(3,"0"); const fmtOSFD=n=>"FD-"+String(n).padStart(3,"0");
const payDate=v=>new Date(v+"T12:00:00");
const CHECKLIST_ITEMS=[{id:"a",label:"Arranhões na lataria"},{id:"b",label:"Painel de instrumentos"},{id:"c",label:"Estofamento"}];
const buildCatOrder=ts=>[...new Set(ts.map(t=>t.category||null))];
const importFinal=p=>Number(p.amount)*Number(p.rate)*(1+p.taxPct/100)+Number(p.extra||0)-Number(p.discount||0);
const taskCost=(t,dr)=>{const rate=t.ratePerHour!=null?Number(t.ratePerHour):dr;const g=Number(t.hours||0)*rate;const d=Math.min(Number(t.discount||0),g);const labor=t.warranty?0:Math.max(0,g-d);const mat=(t.materials||[]).reduce((s,m)=>m.noCharge?s:s+(m.fromStock?m.cost:m.cost*(1+(m.markup!=null?m.markup:50)/100))*(m.qty||1),0);const freight=(t.materials||[]).reduce((s,m)=>s+Number(m.freight||0),0);return{laborGross:g,discount:d,labor,mat,freight,total:labor+mat+freight,rateType:t.rateType||"hour"};};
const SPEC_SECTIONS=[
  {k:"escopo",label:"Escopo do trabalho",hint:"O que será feito, em linhas curtas (uma por linha) ou em um parágrafo"},
  {k:"etapas",label:"Etapas",hint:"Uma etapa por linha, na ordem em que acontecem"},
  {k:"materiais",label:"Materiais e acabamento",hint:"Um item por linha: tintas, verniz, peças, acabamentos"},
  {k:"prazo",label:"Prazo estimado",hint:"Ex.: 15 a 20 dias úteis"},
  {k:"garantia",label:"Garantia",hint:"Ex.: 12 meses contra defeitos de pintura"},
];
const specHasContent=t=>!!(t&&t.spec&&SPEC_SECTIONS.some(x=>String(t.spec[x.k]||"").trim()));
const pdfImg=async(u)=>{const b=require('fs').readFileSync(require('path').join(__dirname,'..','public')+u.replace('osc-group-logo-light','osc-group-full-light'));return {d:'data:image/png;base64,'+b.toString('base64'),w:660,h:178,fmt:'PNG'}};

const __fs=require('fs'), __path=require('path');
const __app=__fs.readFileSync(__path.join(__dirname,'..','src','App.jsx'),'utf8');
const __a=__app.indexOf('async function renderElegantQuote(o) {');
let __fn=__app.slice(__a); __fn=__fn.slice(0,__fn.indexOf('\n}\n')+3).replace('doc.save(fileName);','require("fs").writeFileSync(fileName,Buffer.from(doc.output("arraybuffer")));');
eval('globalThis.renderElegantQuote='+__fn.replace('async function renderElegantQuote','async function'));
const __ext=(sig,name)=>{const a=__app.indexOf(sig);let f=__app.slice(a);f=f.slice(0,f.indexOf('\n}\n')+3);eval('globalThis.'+name+'='+f.replace(/^(async )?function \w+/,'$1function'));};
__ext('async function generatePartialChargePDF(','generatePartialChargePDF');
__ext('function partialChargeItems(','partialChargeItems');
__ext('function partialChargeBuild(','partialChargeBuild');
const renderElegantQuote=(...a)=>globalThis.renderElegantQuote(...a);

const tests=async()=>{
 const esc="Remoção e reinstalação dos dois cabeçotes do motor 6.1 HEMI V8, equipado com sistema de sobrealimentação ProCharger, visando à substituição das juntas de vedação originais por juntas de alta performance Cometic MLS e à instalação de prisioneiros de cabeçote reforçados.\n\nO serviço contempla a desmontagem criteriosa dos componentes periféricos necessários ao acesso, incluindo elementos do sistema ProCharger, coletores de admissão e escapamento, componentes auxiliares e conjunto de acionamento das válvulas.\n\nApós a remoção, os cabeçotes serão encaminhados à retífica especializada para conferência de planicidade e avaliação do acabamento superficial, verificando sua compatibilidade com as exigências das juntas MLS. As superfícies de assentamento do bloco também serão inspecionadas e preparadas para a montagem.\n\nA reinstalação será realizada com juntas Cometic MLS e prisioneiros de cabeçote, observando os procedimentos específicos de limpeza, preparação das roscas, lubrificação dos elementos de fixação e sequência de aperto estabelecidos pelos respectivos fabricantes.\n\nO serviço será concluído com a remontagem dos componentes removidos, reinstalação do sistema ProCharger, reposição dos fluidos necessários e realização de verificações de estanqueidade e funcionamento do conjunto mecânico.";
 const etapas=["Preparação do veículo e drenagem dos fluidos necessários","Remoção dos componentes do sistema ProCharger que interferem no acesso aos cabeçotes","Desmontagem dos coletores de admissão e escapamento e demais periféricos","Remoção das tampas de válvulas, balancins e varetas","Remoção dos dois cabeçotes do motor","Encaminhamento dos cabeçotes para conferência de planicidade e acabamento superficial em retífica especializada","Inspeção das superfícies de assentamento do bloco e avaliação das condições gerais dos componentes desmontados","Limpeza e preparação criteriosa das superfícies de assentamento para instalação das juntas MLS","Limpeza, inspeção das roscas e instalação dos prisioneiros de cabeçote conforme especificações do fabricante","Posicionamento das juntas Cometic MLS e instalação dos cabeçotes","Aplicação da sequência de aperto e torque especificados para o conjunto de fixação utilizado","Reinstalação dos componentes do trem de válvulas e tampas dos cabeçotes","Remontagem dos coletores, periféricos e sistema ProCharger","Reposição dos fluidos e verificação dos sistemas auxiliares","Partida inicial, inspeção de vazamentos e testes de funcionamento"];
 const mats=["Juntas de cabeçote Cometic MLS de alta performance, com espessura e aplicação adequadas ao motor","Kit de prisioneiros de cabeçote de alta resistência, compatível com o motor 6.1 HEMI","Juntas e elementos de vedação dos componentes desmontados, conforme necessário","Lubrificante de montagem e fixação conforme especificações do fabricante dos prisioneiros","Fluido de arrefecimento conforme especificação do fabricante","Materiais de limpeza e preparação das superfícies de assentamento","Conferência do acabamento superficial e compatibilidade com as juntas MLS","Aplicação dos procedimentos específicos de montagem e torque do conjunto de fixação"];
 const prazo="Estimativa de 38 horas técnicas de mão de obra, com prazo previsto de 10 a 15 dias úteis, condicionado à disponibilidade das peças importadas e à conclusão da retífica dos cabeçotes pelo prestador especializado.";
 const gar="Garantia de 90 dias sobre os serviços de mão de obra executados, observadas as condições legais aplicáveis.\nA garantia não abrange danos decorrentes de causas externas ao serviço, como detonação, superaquecimento, falhas de alimentação ou ignição, utilização inadequada ou condições de sobrealimentação incompatíveis com a integridade do conjunto mecânico, desde que não decorrentes de falha na execução do serviço.\nEventuais irregularidades identificadas durante a desmontagem, incluindo necessidade de usinagem, reparo de roscas ou correções adicionais no bloco e nos cabeçotes, serão comunicadas e orçadas separadamente, mediante aprovação prévia.";
 const t1={id:"1",vehicleId:"v",label:"Remoção e reinstalação dos cabeçotes",hours:38,ratePerHour:420,discount:0,division:"performance",featured:true,category:"Projeto",materials:[],spec:{escopo:esc,etapas:etapas.join("\n"),materiais:mats.join("\n"),prazo,garantia:gar}};
 const t2={id:"2",vehicleId:"v",label:"Retífica dos cabeçotes",hours:1,ratePerHour:2260,discount:0,division:"performance",outsourced:true,category:"Motor",materials:[]};
 const vehicle={model:"Dodge Challenger SRT8",plate:"EDU2J19",year:2010,color:"Amarelo",osNumber:174,importParts:[{name:"Kit de junta superior Cometic",amount:497.70,rate:5.0,taxPct:60,status:"A caminho"},{name:"Prisioneiros de cabeçote ARP",amount:419.99,rate:5.0,taxPct:60,status:"A caminho"}]};
 await globalThis.renderElegantQuote({vehicle,ts:[t1,t2],warrantyTs:[],client:{name:"Alessandro Valentino Biond Cioffi",phone:"21975166070"},employee:{name:"OSC"},company:{name:"OSC Group",address:"Estrada da Ilha, 2706 - Galpão 04, Guaratiba",phone:"21966816241",document:"23783927000140"},defaultRate:420,accent:[221,139,52],accentText:[190,105,25],divisionName:"OSC Group",osLabel:"OS-174",notes:"",checklist:[],perf:true,payments:[],osDiscountPct:0,tagline:"x",fileName:process.argv[2]||"teste-orcamento.pdf"});
};
const parcial=async()=>{
 const out=(process.argv[2]||"parcial.pdf").replace(/\.pdf$/,"");
 const company={name:"OSC Group",address:"Estrada da Ilha, 2706 - Galpão 04, Guaratiba",phone:"21966816241",document:"23783927000140"};
 const client={name:"Alessandro Valentino Biond Cioffi",phone:"21975166070"};
 const tasks=[
  {id:"a",vehicleId:"v",label:"Troca de óleo e filtros",hours:1.5,ratePerHour:300,division:"performance",category:"Manutenção",done:true,materials:[{name:"Óleo 5W30 sintético",brand:"Motul",qty:7,cost:60,markup:50},{name:"Filtro de óleo",brand:"Mopar",qty:1,cost:80,markup:50},{name:"Filtro de ar",qty:1,cost:120,markup:50}]},
  {id:"b",vehicleId:"v",label:"Remoção e reinstalação dos cabeçotes",hours:38,ratePerHour:420,discount:500,division:"performance",category:"Motor",materials:[{name:"Juntas Cometic MLS",qty:2,cost:900,markup:30,freight:80}]},
  {id:"c",vehicleId:"v",label:"Pendência interna",hours:0,division:"performance",materials:[]},
  {id:"d",vehicleId:"v",label:"Reaperto do coletor",hours:2,warranty:true,division:"performance",materials:[]},
  {id:"e",vehicleId:"v",label:"Pintura do capô",hours:10,ratePerHour:250,division:"finishing",category:"Pintura",materials:[{name:"Verniz HS",qty:1,cost:300,markup:50},{name:"Lixas",qty:10,cost:5,markup:50}]},
  {id:"f",vehicleId:"v",label:"Polimento técnico",hours:6,ratePerHour:250,division:"finishing",category:"Polimento",materials:[]},
 ];
 const vehicle={id:"v",model:"Dodge Challenger SRT8",plate:"EDU2J19",year:2010,color:"Amarelo",osNumber:174,osNumberFinishing:31,osDiscountPct:10,
  tows:[{origin:"Barra",destination:"Oficina",value:350}],importParts:[{name:"Prisioneiros de cabeçote ARP",amount:419.99,rate:5.0,taxPct:60}]};
 // Performance: óleo só peças (sem MO e sem filtro de ar), cabeçotes inteiro, garantia, reboque e peça importada
 const ip=partialChargeItems({vehicle,tasks,isFD:false,defaultRate:300});
 console.log("chaves:",[...ip.blocks.flatMap(b=>b.items),...ip.ex].map(x=>x.key).join("  "));
 const sp=new Set(["a:M:óleo 5w30 sintético|motul#1","a:M:filtro de óleo|mopar#1","b:L","b:M:juntas cometic mls|#1","w:d","x:tow:barra|oficina#1","x:imp:prisioneiros de cabeçote arp#1"]);
 const bp=partialChargeBuild({vehicle,tasks,isFD:false,defaultRate:300,sel:sp});
 console.log("Performance: tarefas",bp.ts.map(t=>t.label),"itens",bp.items.length,"total",bp.total.toFixed(2));
 await generatePartialChargePDF({vehicle:bp.vehicle,isFD:false,ts:bp.ts,warrantyTs:bp.warrantyTs,client,employee:{name:"OSC"},company,defaultRate:300,number:2});
 // Finishing: só a MO da pintura e o polimento
 const sf=new Set(["e:L","f:L"]);
 // remover uma peça antes não muda a chave das outras
 const t2=tasks.map(t=>t.id==="a"?{...t,materials:t.materials.slice(1)}:t);
 const k2=partialChargeItems({vehicle,tasks:t2,isFD:false,defaultRate:300}).blocks[0].items.map(x=>x.key);
 console.log("após remover o óleo:",k2.join("  "));
 const bf=partialChargeBuild({vehicle,tasks,isFD:true,defaultRate:300,sel:sf});
 console.log("Finishing: tarefas",bf.ts.map(t=>t.label),"total",bf.total.toFixed(2));
 await generatePartialChargePDF({vehicle:bf.vehicle,isFD:true,ts:bf.ts,warrantyTs:bf.warrantyTs,client,employee:{name:"OSC"},company,defaultRate:300});
};
(process.argv[3]==="parcial"?parcial():tests()).catch(e=>{console.error(e);process.exit(1)});
