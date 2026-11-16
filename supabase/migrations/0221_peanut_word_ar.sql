-- 0221: the Arabic word for peanuts is «فستق عبيد» (Arabic read by a person, 16 November 2026, session AR1).
-- food_attributes.name_ar is the word shown to customers and staff for the allergen; the earlier seed (0021) said «فول سوداني».
update food_attributes set name_ar = 'فستق عبيد' where code = 'peanuts' and name_ar is distinct from 'فستق عبيد';
