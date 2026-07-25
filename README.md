# Zero-Knowledge End-to-End Encrypted File Storage System

> **IIT Jammu — Capstone Project | Phase 1**

A production-grade, zero-knowledge file storage system where **all encryption happens in the browser** using the Web Crypto API. The server stores only ciphertext — it can never read your files or filenames.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                          │
│                                                                   │
│  Password →[PBKDF2+Salt]→ KEK (in memory)                       │
│  KEK →[AES-GCM wrap]→ DEK (per file)                            │
│  File →[split]→ Chunks →[AES-GCM + unique IV]→ Encrypted Chunks │
│  Filename →[AES-GCM + KEK]→ Encrypted Filename                  │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
        │ Only ciphertext + wrapped keys reach the server
        ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Spring Boot Backend (Java 17)                   │
│                                                                   │
│  PostgreSQL: users, files (metadata), file_chunks               │
│  MinIO/S3:   Encrypted chunk blobs                               │
│  JWT:        Stateless auth (HS512, 15min access token)          │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
IIT JAMMU PROJECT/
├── docker-compose.yml          # PostgreSQL + MinIO local dev stack
│
├── backend/                    # Spring Boot 3 + Java 17
│   ├── pom.xml
│   └── src/main/
│       ├── resources/
│       │   ├── application.yml
│       │   └── db/migration/
│       │       ├── V1__create_users_table.sql
│       │       ├── V2__create_files_table.sql
│       │       └── V3__create_file_chunks_table.sql
│       └── java/com/iitjammu/zkfs/
│           ├── ZkFileStorageApplication.java
│           ├── config/
│           │   ├── properties/
│           │   │   ├── JwtProperties.java
│           │   │   └── MinioProperties.java
│           │   ├── CorsConfig.java
│           │   ├── MinioConfig.java
│           │   └── SecurityConfig.java
│           ├── domain/
│           │   ├── User.java
│           │   ├── FileMetadata.java
│           │   └── FileChunk.java
│           ├── repository/
│           │   ├── UserRepository.java
│           │   ├── FileMetadataRepository.java
│           │   └── FileChunkRepository.java
│           └── security/
│               ├── JwtService.java
│               ├── JwtAuthenticationFilter.java
│               └── UserDetailsServiceImpl.java
│
└── frontend/                   # Next.js 14 + TypeScript + Tailwind
    ├── package.json
    ├── tsconfig.json
    ├── tailwind.config.js
    ├── next.config.js
    ├── .env.example
    ├── app/
    │   ├── layout.tsx
    │   └── globals.css
    ├── lib/
    │   ├── crypto/
    │   │   └── index.ts        # Web Crypto API: PBKDF2, AES-GCM, DEK, chunks
    │   └── api/
    │       ├── client.ts       # Axios + JWT interceptor
    │       ├── auth.ts         # Auth endpoints
    │       └── files.ts        # File/chunk endpoints
    ├── hooks/
    │   ├── useAuth.ts          # Auth state + KEK derivation
    │   └── useFileUpload.ts    # Full ZK upload orchestration
    └── components/
        ├── ui/
        │   ├── Button.tsx
        │   └── Input.tsx
        └── files/
            └── FileUploadZone.tsx
```

---

## Quick Start

### 1. Start local infrastructure
```bash
docker-compose up -d
```
- PostgreSQL: `localhost:5432`
- MinIO API: `localhost:9000`
- MinIO Console: [http://localhost:9001](http://localhost:9001) (minioadmin/minioadmin)

### 2. Run the backend
```bash
cd backend
./mvnw spring-boot:run
```
Backend runs on: [http://localhost:8080/api](http://localhost:8080/api)

### 3. Run the frontend
```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```
Frontend runs on: [http://localhost:3000](http://localhost:3000)

---

## Security Model

| Threat | Mitigation |
|--------|-----------|
| Server compromise | KEK derived client-side; server never sees plaintext keys |
| Database breach | Only bcrypt hashes + ciphertext stored |
| Man-in-the-middle | HTTPS in prod + CSP headers |
| JWT theft | Short-lived access tokens (15 min) + HttpOnly refresh |
| Chunk tampering | SHA-256 checksum verified before decryption |
| Brute-force login | bcrypt cost=12 + rate limiting (Phase 2) |

---

## Phase 2 Roadmap
- [ ] Auth controller + service layer
- [ ] File/chunk upload/download REST controllers
- [ ] Login & dashboard UI pages
- [ ] File list with decrypted filenames
- [ ] File download + client-side reassembly
- [ ] Rate limiting, refresh token rotation
- [ ] Presigned URL generation for direct MinIO download

---

## Environment Variables

### Backend (`application.yml` / env vars)
| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PASSWORD` | `changeme` | **Change in prod** |
| `JWT_SECRET` | see yml | **Must be 64+ chars Base64** |
| `MINIO_ENDPOINT` | `http://localhost:9000` | MinIO/S3 endpoint |
| `CORS_EXTRA_ORIGIN` | `` | Additional allowed origin |

### Frontend (`.env.local`)
| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8080/api` | Backend base URL |
