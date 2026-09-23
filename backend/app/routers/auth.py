from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import datetime

from app.database import get_db
from app.models.user import User, UserStatus
from app.schemas.user import Token, UserResponse, EligibilityResponse, UserSignup
from app.utils.auth_utils import verify_password, get_password_hash, create_access_token
from app.dependencies import get_current_user

router = APIRouter(prefix="/auth", tags=["Auth"])

@router.post("/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # Authenticate by email
    user = db.query(User).filter(User.email == form_data.username).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
        
    if user.status == UserStatus.removed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been removed. Contact your administrator."
        )

    # If pending, allow login WITHOUT password so they can be routed to signup
    # We create a token so the frontend can securely call the signup endpoint
    if user.status == UserStatus.pending:
        pass
    else:
        # Verified user must provide valid password
        if not user.password_hash or not verify_password(form_data.password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
            )
            
    # Update presence
    user.last_active_at = datetime.utcnow()
    user.is_online = True
    db.commit()

    # Create JWT token
    access_token = create_access_token(data={"sub": str(user.id), "role": user.role.value})
    
    return {
        "access_token": access_token, 
        "token_type": "bearer",
        "user": user
    }

@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user

@router.get("/eligibility", response_model=EligibilityResponse)
def check_eligibility(email: str, db: Session = Depends(get_db)):
    """
    Public endpoint to check if an email is eligible to sign up.
    Only returns true if the account exists AND is pending.
    Everything else returns generic false.
    """
    user = db.query(User).filter(User.email == email).first()
    if user and user.status == UserStatus.pending:
        return {"eligible": True}
    return {"eligible": False}

@router.post("/signup", response_model=Token)
def complete_signup(signup_data: UserSignup, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    User completes registration. They must already be authenticated with a 'pending' token.
    """
    if current_user.status != UserStatus.pending:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Account is already verified or removed.")
        
    if signup_data.password != getattr(signup_data, "confirm_password", signup_data.password):
        # Validation handled by pydantic or frontend, but just in case
        pass
        
    current_user.username = signup_data.username
    current_user.password_hash = get_password_hash(signup_data.password)
    current_user.status = UserStatus.verified
    current_user.last_active_at = datetime.utcnow()
    current_user.is_online = True
    
    db.commit()
    db.refresh(current_user)
    
    # Issue a fresh token
    access_token = create_access_token(data={"sub": str(current_user.id), "role": current_user.role.value})
    
    return {
        "access_token": access_token, 
        "token_type": "bearer",
        "user": current_user
    }

@router.post("/logout")
def logout(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    current_user.is_online = False
    current_user.last_active_at = datetime.utcnow()
    db.commit()
    return {"message": "Logged out successfully"}

from app.schemas.user import UserProfileUpdate, PasswordChange

@router.post("/profile", response_model=UserResponse)
def update_profile(profile_data: UserProfileUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if profile_data.full_name is not None:
        current_user.full_name = profile_data.full_name
    if profile_data.department is not None:
        current_user.department = profile_data.department
        
    db.commit()
    db.refresh(current_user)
    return current_user

@router.post("/profile/password")
def change_password(password_data: PasswordChange, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not current_user.password_hash or not verify_password(password_data.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect current password")
        
    current_user.password_hash = get_password_hash(password_data.new_password)
    db.commit()
    return {"message": "Password updated successfully"}
