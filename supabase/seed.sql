-- Dev seed. Run after you have signed up one user and created an org through the app (/onboarding).
-- It fills the first organization with sample partners, deals, payments and tasks so every screen has data.
do $$
declare o uuid; m uuid; p1 uuid; p2 uuid; p3 uuid; st uuid;
begin
  select id into o from organizations order by created_at limit 1;
  if o is null then raise notice 'Create an org through the app first'; return; end if;
  select id into m from members where org_id = o and role = 'owner_admin' limit 1;
  select id into st from partner_statuses where org_id = o and name = 'Live' limit 1;

  insert into partners(org_id,name,type,contact_name,email,owner_id,status_id,traffic_sources,geos,joined_at)
    values (o,'Lucky Partners','publisher','Maya Levi','maya@luckypartners.com',m,st,'{SEO}','{UK,IE}',current_date-400) returning id into p1;
  insert into partners(org_id,name,type,contact_name,owner_id,status_id,traffic_sources,geos,joined_at)
    values (o,'Sara Klein Media','publisher','Sara Klein',m,st,'{Social}','{DE,AT}',current_date-200) returning id into p2;
  insert into partners(org_id,name,type,contact_name,owner_id,status_id,geos,joined_at)
    values (o,'BetNova','advertiser','Ops Desk',m,st,'{UK}',current_date-600) returning id into p3;

  insert into deals(org_id,partner_id,direction,brand,kind,amount,cap,progress,status,owner_id,geos,metric)
    values (o,p1,'out','LuckySpin','cpa',170,300,212,'live',m,'{UK}','QFTD'),
           (o,p2,'out','BetNova','revshare',null,null,0,'pending_approval',m,'{DE}','Net revenue'),
           (o,p3,'in','BetNova','hybrid',220,null,0,'live',m,'{UK}','QFTD');
  update deals set rev_share_pct = 30 where org_id = o and kind = 'revshare';

  insert into payments(org_id,partner_id,direction,period,expected,tracker_amount,status,blocker,owner_id,due_on,calc)
    values (o,p1,'out',date_trunc('month',current_date-30),24100,24100,'approved',null,m,current_date+3,'CPA $170 × 142 QFTD'),
           (o,p2,'out',date_trunc('month',current_date-30),11500,10000,'difference','Bonus $1,500 missing in the statement',m,current_date+5,'CPA $150 × 66 + bonus'),
           (o,p3,'in',date_trunc('month',current_date-30),70000,null,'invoiced',null,m,current_date-5,'Advertiser deal');

  insert into tasks(org_id,partner_id,title,category,assignee_id,priority,due_on)
    values (o,p1,'Send the UK tracking link','Tech',m,'high',current_date-1),
           (o,p2,'Confirm the DE creatives','Follow-up',m,'normal',current_date);

  insert into conversations(org_id,channel,external_id,title,partner_id,owner_id,unread,last_message_at)
    values (o,'telegram','demo-1','Lucky Partners',p1,m,true,now()-interval '5 minutes');
  insert into messages(org_id,conversation_id,direction,sender_name,body)
    select o,id,'in','Maya','Can we get the UK numbers for this week?' from conversations where external_id='demo-1' and org_id=o;

  insert into automations(org_id,name,trigger,actions)
    values (o,'Silent partner','{"type":"no_message","days":3}','[{"type":"create_task"}]');
end $$;
