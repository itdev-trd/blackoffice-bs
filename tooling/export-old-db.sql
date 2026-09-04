-- ============================================================
--  ย้ายข้อมูล: ฐานเก่า (zaozcluzvbiwpmubmecu) → ฐานใหม่ (nmetbatfjiagpjbbmowp)
--  ขั้นที่ 1 · ดึงข้อมูลออกจากฐานเก่า
-- ============================================================
--
--  วิธีใช้ที่ปลอดภัยที่สุด:
--    1. เลือกทั้งไฟล์ (Cmd+A) แล้ว "ลบทิ้ง" ในแท็บ SQL Editor
--    2. ก๊อปมาแค่ "คำสั่งเดียว" จากส่วน B ด้านล่าง (ทั้งคำสั่ง ตั้งแต่ select ถึง ;)
--    3. Run → Export ▾ → Download CSV → ตั้งชื่อไฟล์ตามหมายเลข
--    4. ลบทิ้ง แล้วก๊อปคำสั่งถัดไป
--
--  ⚠️ เหตุที่คำสั่งในส่วน B ไม่มีคอมเมนต์ปนเลย:
--     ถ้าลากเลือกแล้วเผลอตัดกลางเครื่องหมาย -- จะเหลือ - ขีดเดียว
--     SQL จะอ่านเป็นเครื่องหมายลบ แล้วขึ้น syntax error at or near "-"
--     (เกิดขึ้นจริงรอบก่อน) — คำอธิบายทั้งหมดจึงย้ายมาอยู่ส่วน A แยกจากคำสั่ง
--
--  ⚠️ ห้าม export: app_secrets (ความลับ กรอกใหม่เอง) · backup_* (สำเนาเก่า)


-- ════════════════════════════════════════════════════════════
--  ส่วน A · คำอธิบาย (อ่านที่นี่ ไม่ต้องก๊อป)
-- ════════════════════════════════════════════════════════════
--
--  ลำดับที่ 1 — สำคัญที่สุด ทำก่อน 4 ไฟล์
--    01_customers.csv       7,358 แถว  ลูกค้า · ตัด transcript ตามที่ตกลง (กันเว็บหนัก)
--    02_tv_access.csv         651 แถว  ตัวเชื่อม username ↔ ไอดีเทรด/อีเมล/คนที่ให้สิทธิ์
--    03_chat_referrals.csv  1,797 แถว  ลูกค้าคนไหนมาจากแอดตัวไหน (ฝั่งใหม่ 0 แถว)
--    04_saved_replies.csv      24 แถว  คลังข้อความสำเร็จรูป (ฝั่งใหม่ว่างเปล่า)
--
--  ลำดับที่ 2 — ตั้งค่าและสิทธิ์
--    05_page_lead_config.csv   26 แถว  (ฝั่งใหม่มี 1)
--    06_settings.csv           38 แถว  (ฝั่งใหม่มี 18) ไม่ใช่ความลับ
--    07_user_permissions.csv    9 แถว  (ฝั่งใหม่มี 2)
--    08_tv_brands.csv           2 แถว
--    09_tv_scripts.csv          2 แถว
--    10_profiles.csv
--    11_trade_id_cache.csv    167 แถว  ผลเช็คไอดีเทรดที่เคยทำ ไม่ต้องเช็คซ้ำ
--
--  ลำดับที่ 3 — ประวัติ/สถิติ ไฟล์ใหญ่ ทำทีหลังได้
--    12_reply_stats.csv    26,688 แถว / 13 MB  แต้มตอบแชทของทีม
--                          ถ้าดาวน์โหลดไม่ไหว เติมท้ายก่อน ; ว่า
--                          where msg_at >= '2026-07-01'
--    13_ad_content.csv · 14_ad_copies.csv · 15_ad_images.csv   ไม่กี่สิบแถว
--    16_metrics_log.csv       823 แถว
--    17_ad_config_snapshots.csv  51 แถว
--
--  ตั้งใจข้าม (ตัดสินใจแล้ว ไม่ใช่ลืม)
--    activity_log 43,374 แถว / 29 MB   log การใช้งาน เริ่มนับใหม่ได้
--    transcript ใน chat_customers      ตัดเพื่อให้เว็บเร็ว
--    chat_latency_events 3,722         โค้ดไม่อ้างถึงเลย (grep 0 ไฟล์)
--    tv_membership_events 688          โค้ดไม่อ้างถึงเลย · ถ้าอยากเก็บบอกได้
--    chat_translations 3,754           ระบบสร้างใหม่ได้เอง
--    ad_insights_cache · customer_report_cache   แคช สร้างใหม่เอง
--    push_subscriptions · push_sent_log          ผูกกับเบราว์เซอร์แต่ละเครื่อง
--    knowledge_qa                      ฝั่งเก่า 0 แถว
--    app_secrets · backup_*            ห้ามย้าย


-- ════════════════════════════════════════════════════════════
--  ส่วน B · คำสั่ง — ก๊อปทีละคำสั่ง (ไม่มีคอมเมนต์ปน ตัดพลาดไม่ได้)
-- ════════════════════════════════════════════════════════════


select id, page_id, page_name, psid, source, customer_name, message_count, user_message_count, trade_id, username, email, phone, province, stage, stage_auto, stage_manual, classified_by, country, cust_lang, profile_pic, manual_data, manual_data_by, manual_data_at, entry_ad_id, entry_ad_name, account_opened_at, comment_post_id, comment_permalink, comment_ad_name, comment_ad_ids, comment_ad_names, comment_is_ad, comment_promoted_to_inbox, last_user_text, last_reply_text, last_reply_by, last_reply_at, first_customer_message_at, last_message_at, cust_read_at, read_at, awaiting_reply, unread, blocked_at, blocked_by, blocked_reason, created_at, updated_at, synced_at from chat_customers;


select * from tv_access;


select * from chat_referrals;


select * from saved_replies;


select * from page_lead_config;


select * from settings;


select * from user_permissions;


select * from tv_brands;


select * from tv_scripts;


select * from profiles;


select * from trade_id_cache;


select * from reply_stats;


select * from ad_content;


select * from ad_copies;


select * from ad_images;


select * from metrics_log;


select * from ad_config_snapshots;
