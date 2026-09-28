import React, { useState, useEffect } from "react";
import { Plus, Trash2, Save, X, Edit2, Check, CheckCircle2, XCircle } from "lucide-react";
import api from "../api/client";

export default function CategorySpecsCard() {
  const [categories, setCategories] = useState([]);
  const [isEditing, setIsEditing] = useState(null);
  const [editForm, setEditForm] = useState({ category_name: "", specifications: [] });
  const [loading, setLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [toastType, setToastType] = useState('success');

  const showToast = (msg, type = 'success') => {
    setToastMessage(msg);
    setToastType(type);
    setTimeout(() => setToastMessage(null), 3000);
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const res = await api.get("/settings/category-specs");
      setCategories(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      // Filter out empty specs
      const cleanedSpecs = editForm.specifications.filter(s => s.trim() !== "");
      if (!editForm.category_name.trim()) {
        showToast("Category name is required", "error");
        return;
      }
      
      await api.post("/settings/category-specs", {
        category_name: editForm.category_name.trim(),
        specifications: cleanedSpecs
      });
      setIsEditing(null);
      fetchCategories();
      showToast("Category spec saved successfully");
    } catch (err) {
      console.error(err);
      showToast("Failed to save category spec", "error");
    }
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      await api.delete(`/settings/category-specs/${deleteConfirmId}`);
      fetchCategories();
      showToast("Deleted successfully");
    } catch (err) {
      console.error(err);
      showToast("Failed to delete", "error");
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const openNewForm = () => {
    setEditForm({ category_name: "", specifications: [""] });
    setIsEditing("new");
  };

  const openEditForm = (cat) => {
    setEditForm({ category_name: cat.category_name, specifications: [...cat.specifications, ""] });
    setIsEditing(cat.id);
  };

  const updateSpecField = (index, value) => {
    const newSpecs = [...editForm.specifications];
    newSpecs[index] = value;
    setEditForm({ ...editForm, specifications: newSpecs });
  };

  const addSpecField = () => {
    setEditForm({ ...editForm, specifications: [...editForm.specifications, ""] });
  };

  const removeSpecField = (index) => {
    const newSpecs = editForm.specifications.filter((_, i) => i !== index);
    setEditForm({ ...editForm, specifications: newSpecs });
  };

  return (
    <div className="mt-8 relative">
      <div className="flex items-center gap-2 text-slate-800 font-bold mb-4">
        <Check size={18} className="text-[#3626A7]" />
        <h2>Category-Based Specifications</h2>
      </div>
      
      {toastMessage && (
        <div className="fixed bottom-4 right-4 bg-slate-800 text-white px-4 py-2 rounded shadow-lg flex items-center gap-2 z-50 animate-fade-in-up">
          {toastType === 'success' ? (
            <CheckCircle2 size={16} className="text-emerald-400" />
          ) : (
            <XCircle size={16} className="text-rose-400" />
          )}
          {toastMessage}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="p-5 flex justify-between items-center border-b border-slate-100">
          <div>
            <h3 className="font-semibold text-slate-800 text-[14px]">Managed Categories</h3>
            <p className="text-slate-500 text-xs mt-1">Define allowed specifications for specific product categories.</p>
          </div>
          {!isEditing && (
            <button 
              onClick={openNewForm}
              className="bg-[#3626A7] hover:bg-blue-800 text-white px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1 transition-colors"
            >
              <Plus size={14} /> Add Category
            </button>
          )}
        </div>

        <div className="p-5 bg-slate-50/50 min-h-[150px]">
          {loading ? (
            <div className="text-sm text-slate-400">Loading...</div>
          ) : isEditing ? (
            <div className="bg-white border border-blue-100 shadow-sm rounded-lg p-5">
              <div className="mb-4">
                <label className="block text-xs font-bold text-slate-700 mb-1">Category Name</label>
                <input 
                  type="text" 
                  value={editForm.category_name} 
                  onChange={e => setEditForm({...editForm, category_name: e.target.value})}
                  placeholder="e.g. Upright Bikes"
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-[#3626A7] focus:border-[#3626A7] outline-none"
                  disabled={isEditing !== "new"}
                />
              </div>

              <div className="mb-4">
                <label className="block text-xs font-bold text-slate-700 mb-2">Allowed Specifications</label>
                <div className="flex flex-col gap-2">
                  {editForm.specifications.map((spec, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input 
                        type="text" 
                        value={spec} 
                        onChange={e => updateSpecField(i, e.target.value)}
                        placeholder="e.g. Flywheel Weight"
                        className="flex-1 border border-slate-200 rounded px-3 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                      <button 
                        onClick={() => removeSpecField(i)}
                        className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  <button 
                    onClick={addSpecField}
                    className="self-start text-xs font-semibold text-[#3626A7] hover:text-blue-800 flex items-center gap-1 mt-1"
                  >
                    <Plus size={14} /> Add Field
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button 
                  onClick={() => setIsEditing(null)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded text-xs font-semibold hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSave}
                  className="px-4 py-2 bg-[#3626A7] text-white rounded text-xs font-semibold hover:bg-blue-800 flex items-center gap-1"
                >
                  <Save size={14} /> Save Category
                </button>
              </div>
            </div>
          ) : categories.length === 0 ? (
            <div className="text-center text-slate-500 py-8 text-sm">
              No category specifications defined yet. Click "Add Category" to start.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {categories.map(cat => (
                <div key={cat.id} className="bg-white border border-slate-200 shadow-sm rounded-lg p-4">
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="font-bold text-slate-800 text-[14px]">{cat.category_name}</h4>
                    <div className="flex gap-1">
                      <button onClick={() => openEditForm(cat)} className="p-1 text-slate-400 hover:text-blue-600"><Edit2 size={14}/></button>
                      <button onClick={() => setDeleteConfirmId(cat.id)} className="p-1 text-slate-400 hover:text-rose-600"><Trash2 size={14}/></button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {cat.specifications.map((s, i) => (
                      <span key={i} className="bg-slate-100 text-slate-600 text-[10px] font-semibold px-2 py-1 rounded">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

