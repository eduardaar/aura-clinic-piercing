import test from "node:test";
import assert from "node:assert/strict";
import { createTenant, loginTenant, req } from "./helpers.mjs";
import { deprovisionTenant } from "../src/services/tenants.js";
import { withTenantSchema } from "../src/db/tenantSession.js";

test("ranking público soma unidades concluídas em 30 dias, agrega variações e desconta devoluções e estornos", async () => {
  const clinic = await createTenant("qa-ranking");
  try {
    const { token } = await loginTenant(clinic.slug, clinic.adminEmail, clinic.adminPassword);
    const api = (path, options = {}) => req(path, { tenant: clinic.slug, token, ...options });
    const products = [];
    for (const [name, sale_value] of [["Mais vendido barato",10],["Joia cara",500],["Destaque manual",100]]) {
      const result = await api("/jewelry", { method:"POST",body:{name,category:"Topos",quantity:100,cost_value:1,sale_value,price_manually_overridden:1,
        can_publish:true,can_sell:true,is_catalog_active:true,is_published:true,virtual_store_active:true,is_featured:name.includes("manual")} });
      assert.equal(result.status,201,JSON.stringify(result.json));products.push(result.json);
    }
    const client = await api("/clients",{method:"POST",body:{full_name:"Cliente ranking",whatsapp:"11912345678"}});
    await withTenantSchema(clinic.tenant.id, async(db)=>{
      const sale = async(product,quantity,{status="concluida",days=0,returned=0,refunded=false,createdDays=days}={})=>{
        const order=await db.run("INSERT INTO sales_orders (client_id,status,total_value,created_at) VALUES (?,?,?,to_char(LOCALTIMESTAMP-? * INTERVAL '1 day','YYYY-MM-DD HH24:MI:SS')) RETURNING id",[client.json.id,status,quantity*10,createdDays]);
        const item=await db.run("INSERT INTO sales_order_items (sales_order_id,product_id,item_type,item_name,quantity,unit_price) VALUES (?,?,'produto',?,?,10) RETURNING id",[order.returnedId,product.id,product.name,quantity]);
        await db.run("INSERT INTO stock_movements (jewelry_id,movement_type,quantity,sales_order_id,sales_order_item_id,created_at) VALUES (?,'Saida',?,?,?,to_char(LOCALTIMESTAMP-? * INTERVAL '1 day','YYYY-MM-DD HH24:MI:SS'))",[product.id,quantity,order.returnedId,item.returnedId,days]);
        if(returned){
          const ret=await db.run("INSERT INTO sales_returns (sales_order_id,client_id,financial_action,total_value,reason) VALUES (?,?,'none',?,'Devolução QA') RETURNING id",[order.returnedId,client.json.id,returned*10]);
          await db.run("INSERT INTO sales_return_items (sales_return_id,sales_order_item_id,quantity,unit_price) VALUES (?,?,?,10)",[ret.returnedId,item.returnedId,returned]);
        }
        if(refunded)await db.run("INSERT INTO payments (client_id,sales_order_id,amount,payment_type,method,status) VALUES (?,?,10,'venda','Pix','refunded')",[client.json.id,order.returnedId]);
      };
      await sale(products[0],8,{days:1,returned:2});
      await sale(products[0],4,{days:2,createdDays:60}); // Pedido antigo, concluído recentemente.
      await sale(products[1],2,{days:1});
      await sale(products[1],50,{days:31});
      await sale(products[1],70,{status:"cancelada"});
      await sale(products[1],90,{status:"pendente"});
      await sale(products[1],20,{refunded:true});
      await sale(products[2],30,{days:40});
    });
    const catalog=await req("/catalog",{tenant:clinic.slug});
    assert.equal(catalog.status,200,JSON.stringify(catalog.json));
    const counts=new Map(catalog.json.items.map(p=>[p.id,p.units_sold_30d]));
    assert.equal(counts.get(products[0].id),10);
    assert.equal(counts.get(products[1].id),2);
    assert.equal(counts.get(products[2].id),0,"destaque manual não interfere nas vendas");
    assert.ok(catalog.json.items.every(p=>!('cost_value' in p)),"ranking não expõe custos");
  } finally { await deprovisionTenant(clinic.tenant.id); }
});
