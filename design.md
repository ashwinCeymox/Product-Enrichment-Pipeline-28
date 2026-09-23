# User Authentication & Role-Based Access Control (RBAC) Design

This document details the architectural and UI design for the Authentication and Authorization system for the Product Enrichment Pipeline.

---

## 1. Role & Permission Matrix

We define three roles with decreasing levels of privilege:

| Feature / Resource | Superadmin (1) | Admin | Normal User | Notes |
| :--- | :---: | :---: | :---: | :--- |
| **System Configuration / API Keys** | **Yes** | No | No | View/Edit `.env` values (DeepSeek, Serper, OpenRouter keys) |
| **User Management (List/Invite/Delete)** | **Yes** | **Yes** | No | Admins can manage normal users; Superadmin manages all |
| **Create Scrape / Enrichment Jobs** | **Yes** | **Yes** | **Yes** | Core pipeline access |
| **Approve / Regenerate Images** | **Yes** | **Yes** | **Yes** | Review queue interaction |
| **Download Output ZIPs** | **Yes** | **Yes** | **Yes** | Access to generated assets |

---

## 2. Database Schema Design

A new `users` table will be introduced to support local authentication:

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('superadmin', 'admin', 'normal')),
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

### Initial Superadmin Bootstrapping
When the application starts, if the `users` table is completely empty, the backend will auto-populate the database with a single Superadmin user.
- Credentials will be read from the environment variables (e.g., `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD`).
- Default fallbacks: `admin@pipeline.io` / `admin123` (prompting update on first login).

---

## 3. Backend API Design (FastAPI)

### Authentication Router (`/api/auth`)
- **`POST /api/auth/login`**
  - **Payload**: `{ "email": "...", "password": "..." }`
  - **Response**: `{ "access_token": "...", "token_type": "bearer", "user": { "email": "...", "role": "..." } }`
  - **Tech**: Uses OAuth2 password flow with `python-jose` for JWT and `passlib[bcrypt]` for password hashing.
- **`GET /api/auth/me`**
  - **Headers**: `Authorization: Bearer <token>`
  - **Response**: `{ "id": "...", "email": "...", "role": "..." }`

### User Management Router (`/api/users`)
- **`GET /api/users`** (Require: Superadmin or Admin)
  - Returns list of all active users in the system.
- **`POST /api/users/invite`** (Require: Superadmin or Admin)
  - **Payload**: `{ "email": "...", "role": "..." }`
  - Creates a pending user profile and returns an auto-generated temporary password.
- **`DELETE /api/users/{user_id}`** (Require: Superadmin)
  - Deactivates or removes a user. Normal admins cannot delete users.

### Security Middleware & Dependency Injection
We will protect routes by using FastAPI dependencies:
```python
# app/dependencies/auth.py
async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    # Verifies JWT and returns the User object
    ...

async def require_superadmin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "superadmin":
        raise HTTPException(status_code=403, detail="Superadmin privileges required")
    return current_user

async def require_admin_or_higher(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in ["superadmin", "admin"]:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return current_user
```

---

## 4. Frontend Architecture (React)

### Auth State Management (`AuthContext.jsx`)
A global context will manage:
- Token storage (persisted in `localStorage` or secure cookie).
- Loaded user profile data (email, role).
- Navigation helper methods (`login()`, `logout()`).

### Protected Routes Wrapper
We wrap authenticated dashboard layouts inside a client-side route guard:
```jsx
const ProtectedRoute = ({ allowedRoles, children }) => {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }
  return children;
};
```

### Pages to Create & Modify

#### 1. Login Page (`/login`)
- Premium dark-themed, glassmorphic layout consistent with the rest of the application dashboard.
- Features standard email and password input with clear error state mapping (e.g., "Invalid credentials").

#### 2. Layout & Sidebar (`Sidebar.jsx`)
- Check `user.role` from the `AuthContext`.
- If role is `normal`, the System settings link icon will be completely hidden from the UI sidebar navigation.

#### 3. System Configuration Page (`Settings.jsx`)
- The **AI Tools Credentials** section will only render if `user.role === 'superadmin'`.
- The **User Permissions & Access** list (Sarah Chen, Marcus Wright, Janet Lee) will be updated to fetch from `/api/users`.
- The **Invite User** button will trigger a modal allowing Superadmins/Admins to invite and assign roles.

---

## 5. Deployment / Configuration Adjustments

In `docker-compose.yml` and `start.sh`, we will make sure the following variables are injected:
- `JWT_SECRET`: Random hash generated at start.
- `SUPERADMIN_EMAIL`: Initial user account configuration.
- `SUPERADMIN_PASSWORD`: Initial password for bootstrap.
