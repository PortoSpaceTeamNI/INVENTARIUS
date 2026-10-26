-- +goose Up
-- A starter tree of categories for a student rocketry team. A category is
-- added only if no category of that name (ignoring case) exists anywhere yet,
-- so existing ones are kept where they are; a subcategory goes under the
-- first category with its parent's name.
CREATE TEMP TABLE seed_categories (pos INTEGER PRIMARY KEY, parent TEXT, name TEXT NOT NULL);
INSERT INTO seed_categories (parent, name) VALUES
    (NULL, 'Electronics'),
    (NULL, 'Mechanical'),
    (NULL, 'Tools'),
    (NULL, 'Consumables'),
    (NULL, 'Safety & PPE'),
    (NULL, 'Recovery'),
    (NULL, 'Propulsion'),
    (NULL, 'Hazardous Materials'),
    (NULL, 'Avionics & Telemetry'),
    (NULL, 'Lab & Test Equipment'),
    (NULL, 'Ground Support'),
    (NULL, 'Office & Computers'),

    ('Electronics', 'Passives'),
    ('Electronics', 'Semiconductors'),
    ('Electronics', 'Integrated Circuits'),
    ('Electronics', 'Connectors'),
    ('Electronics', 'Wire & Cable'),
    ('Electronics', 'PCBs & Dev Boards'),
    ('Electronics', 'Sensors'),
    ('Electronics', 'RF & Antennas'),
    ('Electronics', 'Batteries & Power'),
    ('Electronics', 'Switches & Relays'),

    ('Mechanical', 'Fasteners'),
    ('Mechanical', 'Bearings & Bushings'),
    ('Mechanical', 'Springs'),
    ('Mechanical', 'Seals & O-Rings'),
    ('Mechanical', 'Aluminium Stock'),
    ('Mechanical', 'Steel Stock'),
    ('Mechanical', 'Composites'),
    ('Mechanical', 'Plastics & Foam'),
    ('Mechanical', '3D-Printing Filament'),

    ('Tools', 'Hand Tools'),
    ('Tools', 'Power Tools'),
    ('Tools', 'Measuring Tools'),
    ('Tools', 'Soldering'),

    ('Consumables', 'Adhesives & Epoxy'),
    ('Consumables', 'Tapes'),
    ('Consumables', 'Lubricants'),
    ('Consumables', 'Cleaning'),
    ('Consumables', 'Abrasives'),
    ('Consumables', 'Cable Ties & Heat Shrink'),

    ('Safety & PPE', 'Eye & Face Protection'),
    ('Safety & PPE', 'Gloves'),
    ('Safety & PPE', 'Respiratory & Hearing'),
    ('Safety & PPE', 'First Aid & Fire Safety'),

    ('Recovery', 'Parachutes'),
    ('Recovery', 'Shock Cords'),
    ('Recovery', 'Ejection Hardware'),
    ('Recovery', 'Deployment Bags & Protectors'),

    ('Propulsion', 'Motors & Reloads'),
    ('Propulsion', 'Igniters'),
    ('Propulsion', 'Valves & Fittings'),
    ('Propulsion', 'Tanks & Cylinders'),

    ('Hazardous Materials', 'Energetics'),
    ('Hazardous Materials', 'Propellants & Oxidizers'),
    ('Hazardous Materials', 'Flammables & Solvents'),
    ('Hazardous Materials', 'Compressed Gases'),

    ('Avionics & Telemetry', 'Flight Computers & Altimeters'),
    ('Avionics & Telemetry', 'GPS & Trackers'),
    ('Avionics & Telemetry', 'Radio Modules'),
    ('Avionics & Telemetry', 'Cameras'),

    ('Lab & Test Equipment', 'Power Supplies'),
    ('Lab & Test Equipment', 'Oscilloscopes & Analyzers'),
    ('Lab & Test Equipment', 'Multimeters'),
    ('Lab & Test Equipment', 'Data Acquisition'),

    ('Ground Support', 'Launch Equipment'),
    ('Ground Support', 'Ground Station'),
    ('Ground Support', 'Field Equipment'),

    ('Office & Computers', 'Computers & Peripherals'),
    ('Office & Computers', 'Stationery');

INSERT INTO categories (parent_id, name)
SELECT NULL, s.name FROM seed_categories s
WHERE s.parent IS NULL
  AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.name = s.name COLLATE NOCASE)
ORDER BY s.pos;

INSERT INTO categories (parent_id, name)
SELECT (SELECT p.id FROM categories p WHERE p.name = s.parent COLLATE NOCASE
        ORDER BY p.parent_id IS NOT NULL, p.id LIMIT 1), s.name
FROM seed_categories s
WHERE s.parent IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.name = s.name COLLATE NOCASE)
ORDER BY s.pos;

DROP TABLE seed_categories;

-- +goose Down
-- Nothing: the starter categories may hold items by now, and some may have
-- existed before. Delete unwanted ones on the Categories page.
