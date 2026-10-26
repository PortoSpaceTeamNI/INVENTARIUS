-- +goose Up
-- Floor plans of rooms. A map is drawn in centimetres: the room is width x
-- height, and shapes is a JSON array of rectangles (furniture, storage,
-- doors...), each optionally linked to the location it stands for:
--   {"id","label","kind","color","x","y","w","h","location_id"}
-- The layout is edited in the app, so it is data, not code.
CREATE TABLE room_maps (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    width       REAL NOT NULL CHECK (width > 0),
    height      REAL NOT NULL CHECK (height > 0),
    shapes      TEXT NOT NULL DEFAULT '[]',
    version     INTEGER NOT NULL DEFAULT 1,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The PST room (four 2.44 m containers side by side, 6 m deep), traced from
-- "Planta Contentor PST". Linked to the "Sala PST" location if there is one;
-- its shapes are linked to places in the app.
INSERT INTO room_maps (name, location_id, width, height, shapes)
VALUES ('Sala PST',
    (SELECT id FROM locations WHERE parent_id IS NULL AND name = 'Sala PST' COLLATE NOCASE ORDER BY id LIMIT 1),
    976, 600,
    '[{"id":"s1","label":"Sofá","kind":"furniture","color":"#cbb79a","x":45,"y":5,"w":200,"h":90,"location_id":null},{"id":"s2","label":"Armário azul","kind":"storage","color":"#2563eb","x":5,"y":130,"w":120,"h":60,"location_id":null},{"id":"s3","label":"Bancada esquerda","kind":"storage","color":"#ecd9b8","x":5,"y":190,"w":85,"h":170,"location_id":null},{"id":"s4","label":"Extintor","kind":"fixture","color":"#facc15","x":10,"y":375,"w":95,"h":95,"location_id":null},{"id":"s5","label":"Armário amarelo","kind":"storage","color":"#f5b400","x":5,"y":495,"w":50,"h":95,"location_id":null},{"id":"s6","label":"Móvel pequeno","kind":"storage","color":"#6b4423","x":215,"y":245,"w":25,"h":60,"location_id":null},{"id":"s7","label":"Estante cinzenta","kind":"storage","color":"#c4c8cf","x":250,"y":5,"w":40,"h":305,"location_id":null},{"id":"s8","label":"Bancada cinzenta","kind":"furniture","color":"#dfe2e6","x":335,"y":5,"w":95,"h":40,"location_id":null},{"id":"s9","label":"Mesa central","kind":"furniture","color":"#d2a86e","x":380,"y":210,"w":225,"h":180,"location_id":null},{"id":"s10","label":"Secretária 1","kind":"furniture","color":"#d2a86e","x":440,"y":5,"w":70,"h":60,"location_id":null},{"id":"s11","label":"Secretária 2","kind":"furniture","color":"#d2a86e","x":525,"y":5,"w":70,"h":60,"location_id":null},{"id":"s12","label":"Equipamento","kind":"storage","color":"#555b63","x":600,"y":5,"w":50,"h":55,"location_id":null},{"id":"s13","label":"Armário cinzento","kind":"storage","color":"#c4c8cf","x":660,"y":5,"w":70,"h":90,"location_id":null},{"id":"s14","label":"Mesa direita","kind":"furniture","color":"#d2a86e","x":685,"y":235,"w":145,"h":120,"location_id":null},{"id":"s15","label":"Bancada janela","kind":"furniture","color":"#8b5a2b","x":500,"y":535,"w":225,"h":60,"location_id":null},{"id":"s16","label":"Armário T1","kind":"storage","color":"#8b5a2b","x":745,"y":5,"w":70,"h":60,"location_id":null},{"id":"s17","label":"Armário T2","kind":"storage","color":"#8b5a2b","x":820,"y":5,"w":70,"h":60,"location_id":null},{"id":"s18","label":"Armário T3","kind":"storage","color":"#8b5a2b","x":895,"y":5,"w":75,"h":60,"location_id":null},{"id":"s19","label":"Armário D1","kind":"storage","color":"#8b5a2b","x":910,"y":65,"w":60,"h":70,"location_id":null},{"id":"s20","label":"Armário D2","kind":"storage","color":"#8b5a2b","x":910,"y":140,"w":60,"h":70,"location_id":null},{"id":"s21","label":"Armário grande","kind":"storage","color":"#6b4423","x":900,"y":215,"w":70,"h":200,"location_id":null},{"id":"s22","label":"Armário claro","kind":"storage","color":"#f8d49a","x":910,"y":415,"w":60,"h":115,"location_id":null},{"id":"s23","label":"Bancada canto","kind":"furniture","color":"#6b4423","x":770,"y":535,"w":135,"h":65,"location_id":null},{"id":"s24","label":"Armário verde","kind":"storage","color":"#15803d","x":910,"y":535,"w":60,"h":60,"location_id":null},{"id":"s25","label":"Porta","kind":"fixture","color":"#94a3b8","x":30,"y":590,"w":180,"h":10,"location_id":null},{"id":"s26","label":"Janela","kind":"fixture","color":"#7dd3fc","x":280,"y":590,"w":170,"h":10,"location_id":null},{"id":"s27","label":"Janela","kind":"fixture","color":"#7dd3fc","x":525,"y":590,"w":170,"h":10,"location_id":null},{"id":"s28","label":"Janela","kind":"fixture","color":"#7dd3fc","x":775,"y":590,"w":170,"h":10,"location_id":null}]');

-- +goose Down
DROP TABLE room_maps;
