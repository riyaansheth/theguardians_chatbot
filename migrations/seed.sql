-- Seed: 10 fake Mumbai-region properties for end-to-end testing before real
-- client data exists. Idempotent via ON CONFLICT on (project_name, micro_location).
INSERT INTO properties
  (project_name, developer_name, location, micro_location, city, property_type,
   bhk, configuration, min_price, max_price, price_text, carpet_area,
   possession_status, possession_date, rera_number, amenities, nearby_landmarks,
   suitable_for, source_file)
VALUES
  ('Imperial Heights', 'Imperial Developers', 'Byculla', 'Byculla East', 'Mumbai',
   'residential', '2 BHK', '2 BHK', 28000000, 35000000, '₹2.80 Cr - ₹3.50 Cr', '720 sq.ft.',
   'ready', 'Ready to move', 'P51900012345',
   '["Lift","Gymnasium","Swimming Pool","Clubhouse","24x7 Security"]'::jsonb,
   '["Byculla Station","Jijamata Udyaan","Hospital nearby"]'::jsonb,
   '["small family","self-use"]'::jsonb, 'seed'),

  ('Ruparel Orion', 'Ruparel Realty', 'Byculla', 'Byculla West', 'Mumbai',
   'residential', '1 BHK', '1 BHK', 18500000, 22000000, '₹1.85 Cr - ₹2.20 Cr', '430 sq.ft.',
   'under-construction', 'Dec 2026', 'P51900023456',
   '["Lift","Gymnasium","Landscaped Garden","Security"]'::jsonb,
   '["Byculla Station","Schools nearby"]'::jsonb,
   '["couple","investment"]'::jsonb, 'seed'),

  ('Lodha Park', 'Lodha Group', 'Lower Parel', 'Lower Parel', 'Mumbai',
   'residential', '3 BHK', '3 BHK', 75000000, 95000000, '₹7.50 Cr - ₹9.50 Cr', '1450 sq.ft.',
   'ready', 'Ready to move', 'P51900034567',
   '["Lift","Swimming Pool","Clubhouse","Play Area","Spa","24x7 Security","Parking"]'::jsonb,
   '["Phoenix Mills","Kamala Mills","International Schools"]'::jsonb,
   '["large family","children","self-use"]'::jsonb, 'seed'),

  ('Indiabulls Blu', 'Indiabulls Real Estate', 'Lower Parel', 'Worli Naka', 'Mumbai',
   'residential', '2 BHK', '2 BHK', 42000000, 52000000, '₹4.20 Cr - ₹5.20 Cr', '950 sq.ft.',
   'under-construction', 'Jun 2027', 'P51900045678',
   '["Lift","Swimming Pool","Gymnasium","Clubhouse","Sea View","Parking"]'::jsonb,
   '["Worli Sea Face","Phoenix Mills","Hospitals nearby"]'::jsonb,
   '["small family","investment","self-use"]'::jsonb, 'seed'),

  ('Oberoi Sky City', 'Oberoi Realty', 'Andheri', 'Borivali East', 'Mumbai',
   'residential', '2 BHK', '2 BHK', 31000000, 38000000, '₹3.10 Cr - ₹3.80 Cr', '780 sq.ft.',
   'ready', 'Ready to move', 'P51900056789',
   '["Lift","Swimming Pool","Gymnasium","Play Area","Clubhouse","School in complex","Parking"]'::jsonb,
   '["Western Express Highway","Metro Station","Schools","Hospital"]'::jsonb,
   '["family","children","self-use"]'::jsonb, 'seed'),

  ('Andheri Crest', 'Lokhandwala Infrastructure', 'Andheri', 'Andheri West', 'Mumbai',
   'residential', '3 BHK', '3 BHK', 55000000, 68000000, '₹5.50 Cr - ₹6.80 Cr', '1320 sq.ft.',
   'under-construction', 'Mar 2027', 'P51900067890',
   '["Lift","Swimming Pool","Gymnasium","Clubhouse","Play Area","Parking","24x7 Security"]'::jsonb,
   '["Versova Metro","Lokhandwala Market","Schools","Hospital"]'::jsonb,
   '["large family","children","self-use"]'::jsonb, 'seed'),

  ('Hiranandani Estate', 'Hiranandani Group', 'Thane', 'Ghodbunder Road', 'Thane',
   'residential', '2 BHK', '2 BHK', 16500000, 21000000, '₹1.65 Cr - ₹2.10 Cr', '690 sq.ft.',
   'ready', 'Ready to move', 'P51700078901',
   '["Lift","Swimming Pool","Gymnasium","Clubhouse","Play Area","Hospital in township","School in township"]'::jsonb,
   '["Hiranandani Hospital","Schools","Eastern Express Highway"]'::jsonb,
   '["family","children","parents","self-use"]'::jsonb, 'seed'),

  ('Lodha Amara', 'Lodha Group', 'Thane', 'Kolshet Road', 'Thane',
   'residential', '3 BHK', '3 BHK', 19500000, 27000000, '₹1.95 Cr - ₹2.70 Cr', '1010 sq.ft.',
   'under-construction', 'Sep 2026', 'P51700089012',
   '["Lift","Swimming Pool","Gymnasium","Cricket Ground","Clubhouse","Play Area","Parking"]'::jsonb,
   '["Schools nearby","Viviana Mall","Eastern Express Highway"]'::jsonb,
   '["large family","children","investment"]'::jsonb, 'seed'),

  ('Chembur Grandeur', 'L&T Realty', 'Chembur', 'Chembur East', 'Mumbai',
   'residential', '2 BHK', '2 BHK', 24000000, 30000000, '₹2.40 Cr - ₹3.00 Cr', '710 sq.ft.',
   'ready', 'Ready to move', 'P51900090123',
   '["Lift","Swimming Pool","Gymnasium","Clubhouse","Play Area","Parking","24x7 Security"]'::jsonb,
   '["Monorail","Diamond Garden","Schools","Hospital"]'::jsonb,
   '["family","self-use","parents"]'::jsonb, 'seed'),

  ('Wadhwa Atmosphere', 'Wadhwa Group', 'Chembur', 'Mulund West', 'Mumbai',
   'residential', '1 BHK', '1 BHK', 13500000, 16500000, '₹1.35 Cr - ₹1.65 Cr', '440 sq.ft.',
   'ready', 'Ready to move', 'P51900101234',
   '["Lift","Gymnasium","Landscaped Garden","Parking","Security"]'::jsonb,
   '["Mulund Station","Nirmal Lifestyle Mall","Schools"]'::jsonb,
   '["couple","investment","self-use"]'::jsonb, 'seed')
ON CONFLICT (project_name, COALESCE(micro_location, '')) DO NOTHING;
