# CQA CRM - Backend API (NestJS)

## 🚀 Công nghệ sử dụng

- **NestJS** - Framework chính
- **TypeORM** - ORM cho database
- **PostgreSQL** - Cơ sở dữ liệu
- **JWT** - Xác thực (Access Token + Refresh Token)
- **Passport.js** - Authentication middleware
- **bcryptjs** - Mã hóa mật khẩu
- **class-validator** - Validation DTO

---

## 📁 Cấu trúc thư mục

```
src/
├── main.ts                          # Bootstrap, global config
├── app.module.ts                    # Root module
├── config/
│   ├── jwt.config.ts                # JWT configuration
│   └── database.config.ts           # Database configuration
├── auth/                            # 🔐 Auth module
│   ├── auth.module.ts
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── dto/
│   │   ├── login.dto.ts
│   │   ├── register.dto.ts
│   │   └── refresh-token.dto.ts
│   ├── interfaces/
│   │   └── jwt-payload.interface.ts
│   └── strategies/
│       ├── jwt.strategy.ts
│       └── local.strategy.ts
├── users/                           # 👤 Users module
│   ├── users.module.ts
│   ├── users.controller.ts
│   ├── users.service.ts
│   ├── entities/
│   │   └── user.entity.ts
│   └── dto/
│       ├── create-user.dto.ts
│       └── update-user.dto.ts
└── common/                          # 🛠️ Shared utilities
    ├── decorators/
    │   ├── current-user.decorator.ts
    │   └── roles.decorator.ts
    ├── guards/
    │   ├── jwt-auth.guard.ts
    │   └── roles.guard.ts
    └── filters/
        └── http-exception.filter.ts
```

---

## ⚙️ Cài đặt

### 1. Clone và cài dependencies

```bash
npm install
```

### 2. Cấu hình environment

```bash
cp .env.example .env
```

Chỉnh sửa `.env`:

```env
NODE_ENV=development
PORT=3000
API_PREFIX=api/v1

# Database PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_NAME=cqa_crm
DB_SYNCHRONIZE=true

# JWT
JWT_SECRET=your-super-secret-key
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=your-refresh-secret-key
JWT_REFRESH_EXPIRES_IN=30d
```

### 3. Chạy development server

```bash
npm run start:dev
```

---

## 🔐 Auth API Endpoints

| Method | Endpoint | Mô tả | Auth |
|--------|----------|--------|------|
| POST | `/api/v1/auth/register` | Đăng ký tài khoản | ❌ |
| POST | `/api/v1/auth/login` | Đăng nhập | ❌ |
| POST | `/api/v1/auth/refresh` | Làm mới access token | ❌ |
| GET | `/api/v1/auth/me` | Lấy thông tin bản thân | ✅ JWT |
| POST | `/api/v1/auth/logout` | Đăng xuất | ✅ JWT |

### 👤 Users API Endpoints

| Method | Endpoint | Mô tả | Role yêu cầu |
|--------|----------|--------|--------------|
| GET | `/api/v1/users` | Danh sách users | admin, manager |
| GET | `/api/v1/users/:id` | Chi tiết user | admin |
| PATCH | `/api/v1/users/:id` | Cập nhật user | admin |
| DELETE | `/api/v1/users/:id` | Xóa user | admin |

---

## 📋 Ví dụ request

### Đăng ký

```bash
POST /api/v1/auth/register
{
  "fullName": "Nguyen Van A",
  "email": "nguyenvana@example.com",
  "password": "Password123"
}
```

### Đăng nhập

```bash
POST /api/v1/auth/login
{
  "email": "nguyenvana@example.com",
  "password": "Password123"
}
```

### Gọi API có bảo vệ

```bash
GET /api/v1/auth/me
Authorization: Bearer <access_token>
```

---

## 🛡️ Roles

| Role | Mô tả |
|------|--------|
| `admin` | Toàn quyền |
| `manager` | Quản lý |
| `staff` | Nhân viên |
| `user` | Người dùng thường |

---

## 🔧 Scripts

```bash
npm run start:dev    # Development với hot reload
npm run build        # Build production
npm run start:prod   # Chạy production build
npm run lint         # Kiểm tra lint
npm run test         # Chạy unit tests
```
