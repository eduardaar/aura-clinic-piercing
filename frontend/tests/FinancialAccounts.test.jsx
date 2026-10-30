import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { FinancialAccounts } from "../src/features/finance/FinancialAccounts";

const state=vi.hoisted(()=>({calls:[],accounts:[],history:[],unallocated:[]}));
vi.mock('../src/lib/api',()=>({
  readStoredSession:()=>({user:{id:1,role:'admin'}}),
  useApiInvalidate:()=>vi.fn(),
  useFetch:(path)=>({loading:false,error:'',data:path==='/finance/accounts'?state.accounts:path.startsWith('/finance/account-movements')?{items:state.history,total:state.history.length,offset:0,limit:30}:{items:state.unallocated,total:state.unallocated.length,offset:0,limit:30}}),
  apiFetch:vi.fn(async(path,options)=>{state.calls.push({path,method:options.method,body:JSON.parse(options.body)});return{ok:true,json:async()=>({id:3})};}),
}));
beforeEach(()=>{
  state.calls=[];state.history=[];state.unallocated=[];
  state.accounts=[{id:1,name:'Banco QA',kind:'bank',balance:900,opening_balance:1000,opening_date:'2026-01-01',is_active:true},{id:2,name:'Caixa QA',kind:'cash',balance:100,opening_balance:100,opening_date:'2026-01-01',is_active:true}];
});

it('cadastra a conta com saldo e data de abertura explícitos',async()=>{
  const user=userEvent.setup();render(<FinancialAccounts/>);
  await user.click(screen.getByRole('button',{name:'Nova conta'}));
  const dialog=screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Nome da conta'),{target:{value:'Conta InfinitePay'}});
  fireEvent.change(within(dialog).getByLabelText('Saldo inicial'),{target:{value:'125.40'}});
  fireEvent.change(within(dialog).getByLabelText('Saldo no início de'),{target:{value:'2026-01-01'}});
  await user.click(within(dialog).getByRole('button',{name:'Confirmar'}));
  await waitFor(()=>expect(state.calls[0]).toMatchObject({path:'/finance/accounts',body:{name:'Conta InfinitePay',opening_balance:'125.40',opening_date:'2026-01-01'}}));
});

it('transfere entre contas sem criar uma despesa ou receita duplicada',async()=>{
  const user=userEvent.setup();render(<FinancialAccounts/>);
  await user.click(screen.getByRole('button',{name:'Mais opções'}));
  await user.click(screen.getByRole('menuitem',{name:'Transferir'}));
  await user.click(screen.getByLabelText('Origem do dinheiro'));
  await user.click(screen.getByRole('option',{name:'Banco QA'}));
  await user.click(screen.getByLabelText('Destino do dinheiro'));
  await user.click(screen.getByRole('option',{name:'Caixa QA'}));
  fireEvent.change(screen.getByLabelText('Valor'),{target:{value:'80'}});
  fireEvent.change(screen.getByLabelText('Motivo / descrição'),{target:{value:'Troco do balcão'}});
  await user.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Confirmar'}));
  await waitFor(()=>expect(state.calls[0]).toMatchObject({path:'/finance/account-movements',body:{kind:'transfer',from_account_id:'1',to_account_id:'2',amount:'80',description:'Troco do balcão'}}));
  expect(state.calls).toHaveLength(1);
});

it('associa a conta ao pagamento existente e preserva a origem do lançamento',async()=>{
  state.unallocated=[{id:'payments/7',source_type:'payments',source_id:7,description:'Recebimento #7',amount:50,movement_date:'2026-01-01',payment_method:'Pix'}];
  const user=userEvent.setup();render(<FinancialAccounts/>);
  await user.click(screen.getByLabelText('Conta para Recebimento #7'));
  await user.click(screen.getByRole('option',{name:'Banco QA'}));
  await user.click(screen.getByRole('button',{name:'Associar conta'}));
  await waitFor(()=>expect(state.calls[0]).toMatchObject({path:'/finance/accounts/allocate',body:{source_type:'payments',source_id:7,financial_account_id:'1'}}));
});
