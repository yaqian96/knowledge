DELETE FROM "User" WHERE username = 'demo-user';
INSERT INTO "User" (id, username, email, password, "createdAt", "updatedAt") 
VALUES ('demo-user', 'demo-user', 'demo@example.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', NOW(), NOW());
