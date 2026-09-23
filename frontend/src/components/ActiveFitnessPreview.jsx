import React, { useState, useRef } from 'react';
import { Search, Image as ImageIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import api from '../api/client';

export default function ActiveFitnessPreview({ productData, onViewInImageReview }) {
  if (!productData) return <div className="p-8 text-center text-slate-400">No Product Data</div>;

  const identity = productData.product_identity || {};
  const images = productData.images || {};
  const pricing = productData.pricing || {};
  const highlights = productData["Product Highlights"] || productData.key_features || [];
  const featureData = productData["Feature Data"] || [];
  const about = productData.about_this_item || [];
  const specs = productData["Specification Data"] || productData.specifications || {};
  const faqs = productData.faqs || [];
  const longDesc = productData.long_description || "";
  const shortDesc = productData.short_description || "";
  
  const [activeTab, setActiveTab] = useState('specs');
  
  const [highlightIndex, setHighlightIndex] = useState(0);

  const nextHighlight = () => {
    if (highlights.length > 0) {
      setHighlightIndex((prev) => (prev + 1) % highlights.length);
    }
  };

  const prevHighlight = () => {
    if (highlights.length > 0) {
      setHighlightIndex((prev) => (prev - 1 + highlights.length) % highlights.length);
    }
  };

  // Helper to construct usable image URL for UI
  const resolveImageUrl = (img) => {
    if (!img) return '';
    const srcUrl = img.media || img.url;
    if (srcUrl && srcUrl.startsWith('http')) return srcUrl;
    const path = img.local_path || srcUrl;
    if (path) {
      return `${api.defaults.baseURL}/images/serve?path=${encodeURIComponent(path)}`;
    }
    return 'https://placehold.co/600x600/f1f5f9/94a3b8?text=No+Image';
  };

  const imagesList = Array.isArray(productData.images) ? productData.images : [];
  
  const aiImages = productData['Product Highlights Ai Images'] || {};
  const aiLifestyle = aiImages.lifestyle_images || [];
  const aiFeatures = aiImages.feature_images || [];
  
  const allImages = [...imagesList, ...aiLifestyle, ...aiFeatures];
  const heroImage = allImages.length > 0 ? resolveImageUrl(allImages[0]) : 'https://placehold.co/600x600/f1f5f9/94a3b8?text=No+Image';
  
  const [activeIndex, setActiveIndex] = useState(0);
  
  const activeImageObj = allImages.length > 0 ? allImages[activeIndex] : null;
  const activeImage = activeImageObj ? resolveImageUrl(activeImageObj) : heroImage;
  const isAIGenerated = activeImageObj && activeImageObj.group;

  const handleNextImage = () => {
    if (allImages.length > 0) {
      setActiveIndex((prev) => (prev + 1) % allImages.length);
    }
  };

  const handlePrevImage = () => {
    if (allImages.length > 0) {
      setActiveIndex((prev) => (prev - 1 + allImages.length) % allImages.length);
    }
  };

  return (
    <div className="h-full overflow-y-auto font-sans bg-white text-[#1a1a1a]">
      {/* Top Header */}
      <header className="flex items-center justify-between px-8 py-3.5 border-b border-[#e2e2e2] gap-6 sticky top-0 bg-white z-50">
        <div className="flex items-center">
          <img src={`${import.meta.env.BASE_URL}afs-logo-main-en.png`} alt="Active Fitness Store" className="h-[42px] object-contain" />
        </div>
        <div className="hidden md:flex flex-1 max-w-[760px] items-center gap-2.5 bg-[#f7f7f7] border border-[#e2e2e2] rounded-md px-3.5 py-2.5 text-[#555555]">
          <Search size={16} />
          <input type="text" placeholder="Shop From 15000+ Products" className="border-none bg-transparent outline-none flex-1 text-[13px] text-[#1a1a1a]" disabled />
        </div>
        <div className="flex items-center gap-6 text-[12px] font-bold tracking-wide whitespace-nowrap text-[#1a1a1a]">
          <div className="hidden lg:flex items-center gap-1.5 cursor-pointer">📍 STORE LOCATIONS</div>
          <div className="flex items-center gap-1.5 cursor-pointer">🌐 EN ▾</div>
          <div className="flex items-center gap-1.5 cursor-pointer">👤 ▾</div>
          <div className="relative flex items-center cursor-pointer">
            🛒
            <span className="absolute -top-2 -right-2.5 bg-[#d5222a] text-white text-[9px] font-extrabold w-4 h-4 rounded-full flex items-center justify-center">0</span>
          </div>
        </div>
      </header>

      {/* Main Nav */}
      <nav className="hidden md:flex items-center gap-8 px-8 py-3.5 border-b border-[#e2e2e2] text-[12.5px] font-extrabold tracking-wide">
        <div className="flex items-center gap-2 cursor-pointer">☰ SHOP BY CATEGORY</div>
        <div className="cursor-pointer hover:text-[#d5222a]">FITNESS</div>
        <div className="cursor-pointer hover:text-[#d5222a]">SPORTS</div>
        <div className="cursor-pointer hover:text-[#d5222a]">WELLNESS</div>
        <div className="cursor-pointer hover:text-[#d5222a]">PERFORMANCE</div>
        <div className="cursor-pointer hover:text-[#d5222a]">SALE</div>
        <div className="cursor-pointer hover:text-[#d5222a]">COMMERCIAL</div>
        <div className="ml-auto text-[#d5222a] flex items-center gap-2 cursor-pointer">
          <span className="w-5 h-5 rounded-full bg-[#d5222a] flex items-center justify-center text-white text-[9px]">▶</span> WHAT'S NEW
        </div>
      </nav>

      {/* Breadcrumb */}
      <div className="px-8 pt-4 pb-2 text-[12.5px] text-[#555555]">
        {productData.breadcrumbs?.map((crumb, idx) => (
          <React.Fragment key={idx}>
            <span className="hover:text-[#111111] hover:underline cursor-pointer">{crumb}</span>
            {idx < productData.breadcrumbs.length - 1 && <span className="mx-1.5">/</span>}
          </React.Fragment>
        )) || (
          <><span className="hover:text-[#111111] hover:underline cursor-pointer">Home</span> <span className="mx-1.5">/</span> <span className="hover:text-[#111111] hover:underline cursor-pointer">Fitness</span> <span className="mx-1.5">/</span> <span>{identity.product_name}</span></>
        )}
      </div>

      {/* Product Section */}
      <div className="grid grid-cols-1 lg:grid-cols-[100px_1fr_380px] gap-8 px-8 pt-5 items-start max-w-[1400px] mx-auto">
        
        {/* Thumbnails */}
        <div className="flex lg:flex-col gap-3 overflow-x-auto lg:overflow-y-auto lg:max-h-[600px] order-2 lg:order-1 scrollbar-hide pb-2 lg:pb-0 pr-1">
          {allImages.map((img, i) => (
            <img 
              key={i} 
              src={resolveImageUrl(img)} 
              alt="Thumbnail" 
              onClick={() => setActiveIndex(i)}
              className={clsx(
                "w-[84px] h-[84px] object-cover border rounded-md cursor-pointer shrink-0 transition-all",
                activeIndex === i ? "border-[#111111] border-2" : "border-[#e2e2e2] hover:border-[#8a8a8a]"
              )}
            />
          ))}
        </div>

        {/* Main Gallery */}
        <div className="flex flex-col items-center relative order-1 lg:order-2">
          <div className="relative w-full aspect-square bg-[#f7f7f7] rounded-md flex items-center justify-center overflow-hidden border border-[#e2e2e2] group">
            <img src={activeImage} alt="Main Product" className="w-full h-full object-contain mix-blend-multiply" />
            
            {isAIGenerated && (
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-20">
                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    if (onViewInImageReview) onViewInImageReview(activeImageObj.group); 
                  }}
                  className="bg-white text-slate-900 px-4 py-2 rounded-md text-sm font-bold shadow-md hover:bg-slate-100 transition-colors flex items-center gap-2 pointer-events-auto"
                >
                  <ImageIcon size={16} />
                  View in Image Review
                </button>
              </div>
            )}

            <button onClick={handlePrevImage} className="absolute left-2.5 top-1/2 -translate-y-1/2 w-[34px] h-[34px] rounded-full bg-white border border-[#e2e2e2] flex items-center justify-center shadow-sm hover:bg-gray-50 text-[14px] z-30">‹</button>
            <button onClick={handleNextImage} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-[34px] h-[34px] rounded-full bg-white border border-[#e2e2e2] flex items-center justify-center shadow-sm hover:bg-gray-50 text-[14px] z-30">›</button>
          </div>
          <div className="flex flex-wrap justify-center gap-1.5 mt-3.5 max-w-[80%] mx-auto">
            {allImages.map((img, i) => (
              <span key={i} onClick={() => setActiveIndex(i)} className={clsx("w-[34px] h-[3px] rounded-full cursor-pointer hover:bg-[#8a8a8a]", activeIndex === i ? "bg-[#111111]" : "bg-[#e2e2e2]")}></span>
            ))}
          </div>
        </div>

        {/* Buy Box */}
        <div className="order-3 pb-10">
          <h1 className="text-[26px] font-extrabold leading-tight mb-3.5 text-[#111111]">{identity.product_name}</h1>
          <div className="text-[24px] font-extrabold mb-3.5">AED {pricing.price || 'XXX.00'}</div>



          {identity.model && (
            <div className="mt-4">
              <div className="font-extrabold text-[13px] mb-2">Model</div>
              <div className="inline-block border border-[#1a1a1a] rounded px-4 py-2 text-[13px] font-semibold bg-white cursor-pointer">{identity.model}</div>
            </div>
          )}

          <div className="flex gap-3.5 mt-2.5">
            <button className="flex-1 py-4 bg-[#111111] text-white rounded text-[13px] font-extrabold tracking-wide hover:bg-[#333] transition-colors">ADD TO CART</button>
            <button className="flex-1 py-4 bg-[#d5222a] text-white rounded text-[13px] font-extrabold tracking-wide hover:bg-[#b81c23] transition-colors">BUY NOW</button>
          </div>

          <div className="flex gap-6 mt-4 text-[12.5px] font-bold text-[#1a1a1a]">
            <div className="flex items-center gap-1.5 cursor-pointer hover:text-[#d5222a]">♡ WISHLIST</div>
            <div className="flex items-center gap-1.5 cursor-pointer hover:text-[#d5222a]">⇄ COMPARE</div>
            <div className="flex items-center gap-1.5 cursor-pointer hover:text-[#d5222a]">⤴ SHARE</div>
          </div>


          {about.length > 0 && (
            <div className="mt-6 pt-4 border-t border-[#e2e2e2]">
              <h4 className="text-[13px] tracking-wide mb-2 font-bold">ABOUT THIS ITEM</h4>
              <ul className="list-disc pl-4 text-[13px] text-[#555555] mb-2 space-y-1">
                {about.slice(0, 3).map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
              <a href="#specs-tab" className="text-[#111111] underline text-[13px] font-semibold hover:text-[#d5222a]" onClick={(e) => { e.preventDefault(); setActiveTab('specs'); }}>Learn more</a>
            </div>
          )}


        </div>
      </div>

      {/* Tabs Section */}
      <div className="mt-6 px-8 pb-16 max-w-[1400px] mx-auto" id="specs-tab">
        <div className="flex gap-8 border-b border-[#e2e2e2]">
          <div onClick={() => setActiveTab('specs')} className={clsx("py-4 font-extrabold text-[13px] tracking-wide cursor-pointer border-b-2", activeTab === 'specs' ? "text-[#d5222a] border-[#d5222a]" : "text-[#555555] border-transparent hover:text-[#1a1a1a]")}>SPECIFICATIONS</div>
          <div onClick={() => setActiveTab('features')} className={clsx("py-4 font-extrabold text-[13px] tracking-wide cursor-pointer border-b-2", activeTab === 'features' ? "text-[#d5222a] border-[#d5222a]" : "text-[#555555] border-transparent hover:text-[#1a1a1a]")}>FEATURES</div>
          <div onClick={() => setActiveTab('highlights')} className={clsx("py-4 font-extrabold text-[13px] tracking-wide cursor-pointer border-b-2", activeTab === 'highlights' ? "text-[#d5222a] border-[#d5222a]" : "text-[#555555] border-transparent hover:text-[#1a1a1a]")}>PRODUCT HIGHLIGHTS</div>
          <div onClick={() => setActiveTab('long_desc')} className={clsx("py-4 font-extrabold text-[13px] tracking-wide cursor-pointer border-b-2", activeTab === 'long_desc' ? "text-[#d5222a] border-[#d5222a]" : "text-[#555555] border-transparent hover:text-[#1a1a1a]")}>LONG DESCRIPTION</div>
          <div onClick={() => setActiveTab('short_desc')} className={clsx("py-4 font-extrabold text-[13px] tracking-wide cursor-pointer border-b-2", activeTab === 'short_desc' ? "text-[#d5222a] border-[#d5222a]" : "text-[#555555] border-transparent hover:text-[#1a1a1a]")}>SHORT DESCRIPTION</div>
          <div onClick={() => setActiveTab('faq')} className={clsx("py-4 font-extrabold text-[13px] tracking-wide cursor-pointer border-b-2", activeTab === 'faq' ? "text-[#d5222a] border-[#d5222a]" : "text-[#555555] border-transparent hover:text-[#1a1a1a]")}>FAQS</div>
          <div onClick={() => setActiveTab('policy')} className={clsx("py-4 font-extrabold text-[13px] tracking-wide cursor-pointer border-b-2", activeTab === 'policy' ? "text-[#d5222a] border-[#d5222a]" : "text-[#555555] border-transparent hover:text-[#1a1a1a]")}>SALES POLICY</div>
        </div>

        <div className="max-w-[900px] pt-8">
          {activeTab === 'specs' && (
            <div>
              <h2 className="text-[22px] font-bold tracking-wide mb-4">SPECIFICATIONS</h2>
              <table className="w-full border-collapse mb-8">
                <tbody>
                  {Object.entries(specs).map(([key, val]) => {
                    if (typeof val === 'object' || !val) return null;
                    return (
                      <tr key={key} className="border-b border-[#e2e2e2] hover:bg-[#f7f7f7]">
                        <td className="py-3.5 text-[13px] text-[#555555] w-[45%] pr-4 capitalize">{key.replace(/_/g, ' ')}</td>
                        <td className="py-3.5 text-[13px] font-semibold text-[#1a1a1a]">{val}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'features' && (
            <div>
              <h2 className="text-[22px] font-bold tracking-wide mb-4">FEATURES</h2>
              <table className="w-full border-collapse mb-8">
                <tbody>
                  {featureData.length > 0 ? featureData.map((row, i) => (
                    <tr key={i} className="border-b border-[#e2e2e2] hover:bg-[#f7f7f7]">
                      <td className="py-3.5 text-[13px] text-[#555555] w-[45%] pr-4 capitalize">{row.label}</td>
                      <td className="py-3.5 text-[13px] font-semibold text-[#1a1a1a]">{row.value}</td>
                    </tr>
                  )) : (
                    <tr><td className="py-3 text-[13px] text-[#555555]">No features available.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'highlights' && (
            <div>
              <div className="flex items-center justify-between mb-10">
                <h2 className="text-[22px] font-bold tracking-wide">PRODUCT HIGHLIGHTS</h2>
                <div className="flex items-center gap-2 relative z-50">
                  <button onClick={prevHighlight} className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors">
                    <ChevronLeft size={20} />
                  </button>
                  <button onClick={nextHighlight} className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors">
                    <ChevronRight size={20} />
                  </button>
                </div>
              </div>
              
              <div className="flex flex-col md:flex-row items-center gap-12 md:gap-16 px-4">
                {/* Left side: Card Stack (Images 1:1 ratio) */}
                <div className="relative w-[380px] h-[460px] flex-shrink-0 mx-auto md:mx-0">
                  {highlights.map((feat, idx) => {
                    const featImg = aiFeatures.length > idx ? aiFeatures[idx] : (allImages.length > idx ? allImages[idx] : null);
                    
                    let offset = idx - highlightIndex;
                    if (offset < 0) offset += highlights.length;
                    
                    const isVisible = offset < 3;
                    const zIndex = 30 - offset * 10;
                    const scale = 1 - offset * 0.05;
                    const translateY = offset * 24;
                    const opacity = isVisible ? 1 - offset * 0.15 : 0;
                    
                    return (
                      <div 
                        key={idx}
                        className="absolute top-0 left-0 w-full h-[380px] transition-all duration-500 ease-out cursor-pointer rounded-[24px] bg-white overflow-hidden border border-[#e2e2e2] shadow-[25px_15px_35px_-5px_rgba(0,0,0,0.15)]"
                        style={{
                          zIndex,
                          transform: `translateY(${translateY}px) scale(${scale})`,
                          opacity,
                          visibility: isVisible ? 'visible' : 'hidden',
                          transformOrigin: 'top center'
                        }}
                        onClick={offset === 0 ? nextHighlight : undefined}
                      >
                        {featImg ? (
                           <img src={resolveImageUrl(featImg)} alt={feat.title} className="w-full h-full object-cover bg-white" />
                        ) : (
                           <div className="w-full h-full bg-slate-50 flex items-center justify-center text-slate-300">No Image</div>
                        )}
                      </div>
                    );
                  })}
                </div>
                
                {/* Right side: Fading Text */}
                <div className="w-full relative h-[250px] flex items-center">
                  {highlights.map((feat, idx) => {
                    const isActive = idx === highlightIndex;
                    return (
                      <div 
                        key={idx}
                        className="absolute top-1/2 -translate-y-1/2 left-0 w-full transition-all duration-500 ease-in-out"
                        style={{
                          opacity: isActive ? 1 : 0,
                          transform: isActive ? 'translateY(0)' : 'translateY(15px)',
                          pointerEvents: isActive ? 'auto' : 'none',
                          visibility: isActive ? 'visible' : 'hidden'
                        }}
                      >
                        <h3 className="font-bold text-[26px] mb-4 text-[#1a1a1a]">{feat.title}</h3>
                        <p className="text-[15.5px] text-[#555555] leading-[1.8]">{feat.description}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'long_desc' && (
            <div>
              <h2 className="text-[22px] font-bold tracking-wide mb-4">LONG DESCRIPTION</h2>
              <p className="text-[13.5px] text-[#1a1a1a] leading-[1.7] whitespace-pre-wrap">{longDesc || "No description provided."}</p>
            </div>
          )}

          {activeTab === 'short_desc' && (
            <div>
              <h2 className="text-[22px] font-bold tracking-wide mb-4">SHORT DESCRIPTION</h2>
              <p className="text-[13.5px] text-[#1a1a1a] leading-[1.7] whitespace-pre-wrap">{shortDesc || "No short description provided."}</p>
            </div>
          )}

          {activeTab === 'faq' && (
            <div>
              <h2 className="text-[22px] font-bold tracking-wide mb-6">FREQUENTLY ASKED QUESTIONS</h2>
              {faqs.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {faqs.map((faq, i) => (
                    <details key={i} className="border border-[#e2e2e2] rounded-md group bg-white shadow-sm overflow-hidden open:bg-[#f7f7f7]">
                      <summary className="p-4 font-bold cursor-pointer list-none flex justify-between items-center text-[14px] outline-none select-none hover:bg-[#f7f7f7]">
                        {faq.question}
                        <span className="text-[#d5222a] text-xl font-light group-open:rotate-45 transition-transform duration-300 ml-4 shrink-0">+</span>
                      </summary>
                      <div className="p-4 pt-0 text-[#555555] text-[13.5px] leading-relaxed border-t border-transparent group-open:border-[#e2e2e2] mt-2">
                        {faq.answer}
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <p className="text-[13.5px] text-[#555555]">No FAQs available for this product.</p>
              )}
            </div>
          )}

          {activeTab === 'policy' && (
            <div>
              <h2 className="text-[22px] font-bold tracking-wide mb-4">SALES POLICY</h2>
              <p className="text-[13.5px] text-[#1a1a1a] leading-[1.7]">
                Everything you need to know before and after your purchase — Delivery, Warranty, Returns &amp; Refunds, Cash on Delivery and Installation Details.<br/><br/>
                <a href="#" className="font-bold underline hover:text-[#d5222a]">Read our full policies</a>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
