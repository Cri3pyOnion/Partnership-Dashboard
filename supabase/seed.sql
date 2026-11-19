-- DEV ONLY demo data. Do not run against production.
insert into partners (id, name, phone, email, tin, company, code, referral_name, filled_by, source, status, registered_at) values
  ('TSP0001', 'Tan Wei Ming', '+60123384521', 'weiming@twmaccounting.my', 'IG23019844050', 'TWM Accounting Services', 'A1', 'Jason Lee', 'Transmission', '上门', '活跃', '2026-08-04'),
  ('TSP0002', 'Nur Aisyah binti Rahman', '+60137729015', 'aisyah@ar-cosec.com', 'IG10422758020', 'AR Corporate Secretarial', 'C1', 'Jason Lee', 'Transmission', '上门', '活跃', '2026-08-12'),
  ('TSP0003', 'Lim Siew Ling', '+60162458830', 'siewling@limco.my', 'C2584463202', 'Lim & Co. Accounting', 'C1', null, '市场部', '线上', '活跃', '2026-08-30'),
  ('TSP0004', 'Rajesh Kumar', '+60176031148', 'rajesh@rkproperty.my', 'IG30457710080', 'RK Property Agency', 'A1', 'Tan Wei Ming (TSP0001)', '市场部', '线上', '活跃', '2026-09-06'),
  ('TSP0005', 'Wong Kah Hoe', '+60129015566', 'kahhoe@wkreno.com', 'C1093382104', 'WK Renovation Sdn Bhd', 'B1', 'Mei Chen', 'Transmission', '上门', '活跃', '2026-09-18'),
  ('TSP0006', 'Siti Hajar binti Osman', '+60193342287', 'sitihajar.o@gmail.com', 'IG41128830010', null, 'A1', 'Mei Chen', 'Transmission', '上门', '不活跃', '2026-10-02'),
  ('TSP0007', 'Chong Jia Hui', '+601120874410', 'jiahui@cjhconsult.my', 'C2207719405', 'CJH Business Consultancy', 'B1', null, '市场部', '线上', '活跃', '2026-10-15'),
  ('TSP0008', 'Muhammad Faiz bin Ismail', '+60145567732', 'faiz@fi-fnb.com', 'IG22801945070', 'FI F&B Consultant', 'C1', 'Nur Aisyah (TSP0002)', '市场部', '线上', '活跃', '2026-10-28'),
  ('TSP0009', 'Lee Chun Kit', '+60167780912', 'chunkit@lckaudit.my', 'C1874430206', 'LCK Audit & Tax', 'A1', 'Jason Lee', 'Transmission', '上门', '待审核', '2026-11-10'),
  ('TSP0010', 'Kavitha a/p Subramaniam', '+60124459087', 'kavitha@ksdesign.my', 'IG50092217030', 'KS Interior Design', 'C1', null, '市场部', '线上', '待审核', '2026-11-17');

insert into cases (id, partner_id, client_name, licence_type, council, step, missing_docs, submitted_at, price, markup, client_paid, client_paid_at) values
  ('TS-2611-014', 'TSP0003', 'Kedai Kopi Ah Seng', '营业执照', 'MBPJ', 2, null, '2026-11-03', 1800, 300, false, null),
  ('TS-2611-009', 'TSP0003', 'Glow Beauty Studio', '招牌执照', 'DBKL', 1, '缺少：租约', '2026-10-28', 900, 150, false, null),
  ('TS-2610-031', 'TSP0003', 'Nasi Lemak Corner Sdn Bhd', '清真认证 (JAKIM)', null, 3, null, '2026-10-15', 2500, 400, false, null),
  ('TS-2610-020', 'TSP0003', 'Bright Tuition Centre', '营业执照', 'MBSJ', 4, null, '2026-10-02', 1500, 250, true, '2026-10-25'),
  ('TS-2609-012', 'TSP0003', 'Mega Hardware Trading', '招牌执照', 'MBPJ', 5, null, '2026-09-10', 850, 150, true, '2026-09-28');

-- Explicit ids were used above, so move the counters past them.
select setval('partner_seq', 10);
insert into case_counters (yymm, n) values ('2609', 12), ('2610', 31), ('2611', 14)
on conflict (yymm) do update set n = excluded.n;
