from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models.user import User, UserStatus, UserRole
from app.schemas.user import UserResponse, UserInvite
from app.dependencies import get_current_user, require_admin, require_superadmin

router = APIRouter(prefix="/users", tags=["Users"])

@router.get("/", response_model=List[UserResponse])
def get_users(current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """
    Superadmin sees all users.
    Admin sees only 'user' role accounts.
    """
    if current_user.role == UserRole.superadmin:
        return db.query(User).all()
    else:
        # Admin viewer: filter strictly at DB level
        return db.query(User).filter(User.role == UserRole.user).all()

@router.post("/invite", response_model=UserResponse)
def invite_user(invite: UserInvite, current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """
    Invites a user, or restores/modifies an existing pending/removed user.
    """
    existing_user = db.query(User).filter(User.email == invite.email).first()

    # Rule: Admins cannot invite superadmins
    if invite.role == UserRole.superadmin:
         raise HTTPException(status_code=403, detail="Cannot assign superadmin role")

    if existing_user:
        if existing_user.status == UserStatus.verified:
            raise HTTPException(status_code=400, detail="User already exists and is verified.")
            
        # Target role permission check: 
        # Admins cannot touch an account that is already an 'admin' or 'superadmin'
        if current_user.role != UserRole.superadmin and existing_user.role in [UserRole.admin, UserRole.superadmin]:
            raise HTTPException(status_code=403, detail="You do not have permission to modify an admin account.")

        # Upsert: overwrite role with whatever is newly assigned, and flip status to pending
        existing_user.role = invite.role
        existing_user.status = UserStatus.pending
        
        db.commit()
        db.refresh(existing_user)
        return existing_user

    # Create new user
    new_user = User(
        email=invite.email,
        role=invite.role,
        status=UserStatus.pending
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return new_user

@router.post("/{user_id}/remove")
def remove_user(user_id: str, current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    target_user = db.query(User).filter(User.id == user_id).first()
    
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
        
    if target_user.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot remove yourself.")
        
    if target_user.role == UserRole.superadmin:
        raise HTTPException(status_code=403, detail="Superadmin cannot be removed.")

    # Rule: Admins cannot remove admins
    if current_user.role != UserRole.superadmin and target_user.role == UserRole.admin:
        raise HTTPException(status_code=403, detail="You do not have permission to remove an admin account.")

    # Perform removal (clear PII, set status)
    target_user.status = UserStatus.removed
    target_user.username = None
    target_user.password_hash = None
    target_user.full_name = None
    target_user.department = None
    
    db.commit()
    return {"message": "User removed successfully"}

@router.post("/deactivate")
def self_deactivate(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Self-service deactivation. Clears credentials, sets back to pending.
    """
    if current_user.role == UserRole.superadmin:
        raise HTTPException(status_code=400, detail="Superadmin cannot deactivate themselves.")

    current_user.status = UserStatus.pending
    current_user.username = None
    current_user.password_hash = None
    current_user.full_name = None
    current_user.department = None
    
    db.commit()
    return {"message": "Account deactivated."}
