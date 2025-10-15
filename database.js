// ------------------ IndexedDB ------------------
function initDatabase(){
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onerror = (e) => { 
    console.error('Veritabanı bağlantı hatası!', e);
    notify('Veritabanı bağlantı hatası!', 'error'); 
  };
  
  request.onsuccess = (e) => { 
    db = e.target.result; 
    loadCoursesFromDB();
  };
  
  request.onupgradeneeded = (e) => {
    const database = e.target.result;
    if(!database.objectStoreNames.contains(COURSES_STORE)){
      const cs = database.createObjectStore(COURSES_STORE, { keyPath:'id', autoIncrement:true });
      cs.createIndex('instructor', 'instructor', { unique:false });
    }
    if(!database.objectStoreNames.contains(PARTICIPANTS_STORE)){
      const ps = database.createObjectStore(PARTICIPANTS_STORE, { keyPath:'id', autoIncrement:true });
      ps.createIndex('courseId', 'courseId', { unique:false });
      ps.createIndex('studentNumber', 'studentNumber', { unique:false });
    }
  }
}

function loadCoursesFromDB(){
  if(!db) {
    console.error('DB not initialized');
    return;
  }
  
  const req = tx([COURSES_STORE]).objectStore(COURSES_STORE).getAll();
  req.onsuccess = (e) => {
    courses = e.target.result || [];
    
    // Tüm kurslar için katılımcıları yükle
    let coursesLoaded = 0;
    const totalCourses = courses.length;
    
    if (totalCourses === 0) {
      renderCourses();
      return;
    }
    
    courses.forEach(course => {
      loadParticipantsForCourse(course.id, () => {
        coursesLoaded++;
        if (coursesLoaded === totalCourses) {
          renderCourses();
        }
      });
    });
  };
  
  req.onerror = () => {
    console.error('Kurslar yüklenemedi');
    notify('Kurslar yüklenirken hata oluştu!', 'error');
  };
}

function loadParticipantsForCourse(courseId, callback){
  const store = tx([PARTICIPANTS_STORE]).objectStore(PARTICIPANTS_STORE);
  const idx = store.index('courseId');
  const req = idx.getAll(courseId);
  
  req.onsuccess = (e) => {
    const participants = e.target.result || [];
    const course = courses.find(c => c.id === courseId);
    if(course) {
      course.participants = participants;
    }
    if (callback) callback();
  };
  
  req.onerror = () => {
    console.error('Katılımcılar yüklenemedi for course:', courseId);
    if (callback) callback();
  };
}

// Katılımcı ekledikten sonra kursu güncelle
function addParticipantToCourse(courseId, participant) {
  const course = courses.find(c => c.id === courseId);
  if (course) {
    if (!course.participants) course.participants = [];
    course.participants.push(participant);
  }
}

// Katılımcı sildikten sonra kursu güncelle  
function removeParticipantsFromCourse(courseId) {
  const course = courses.find(c => c.id === courseId);
  if (course) {
    course.participants = [];
  }
}

// handleJoinCourse fonksiyonunu güncelle
function handleJoinCourse(){
  const studentNumber = document.getElementById('studentNumber').value.trim();
  const studentName = document.getElementById('studentName').value.trim();
  const studentSurname = document.getElementById('studentSurname').value.trim();
  const confirmationCode = document.getElementById('confirmationCode').value.trim();

  if(!studentNumber || !studentName || !studentSurname || !confirmationCode){
    notify('Lütfen tüm alanları doldurun!', 'error'); return;
  }
  
  const course = courses.find(c => c.id === selectedCourseId);
  if(!course){ notify('Ders bulunamadı!', 'error'); return; }
  if(course.code !== confirmationCode){ notify('Onay kodu hatalı!', 'error'); return; }
  
  const already = (course.participants || []).some(p => p.studentNumber === studentNumber);
  if(already){ notify('Bu öğrenci numarasıyla zaten kayıtlısınız!', 'error'); return; }

  const participant = { 
    courseId: course.id, 
    studentNumber, 
    studentName, 
    studentSurname, 
    joinDate: new Date().toISOString() 
  };
  
  const store = tx([PARTICIPANTS_STORE], 'readwrite').objectStore(PARTICIPANTS_STORE);
  const req = store.add(participant);
  
  req.onsuccess = (e) => {
    participant.id = e.target.result; 
    addParticipantToCourse(course.id, participant); // Yerel state'i güncelle
    closeModal(joinCourseModal); 
    renderCourses(); 
    notify('Derse başarıyla katıldınız.');
    
    // Formu temizle
    document.getElementById('studentNumber').value = '';
    document.getElementById('studentName').value = '';
    document.getElementById('studentSurname').value = '';
    document.getElementById('confirmationCode').value = '';
  };
  
  req.onerror = () => notify('Katılım işlemi sırasında bir hata oluştu!', 'error');
}

// handleDeleteCourse fonksiyonunu güncelle
function handleDeleteCourse(){
  if(!courseToDeleteId) return;
  
  const t = tx([COURSES_STORE, PARTICIPANTS_STORE], 'readwrite');
  const cs = t.objectStore(COURSES_STORE);
  const ps = t.objectStore(PARTICIPANTS_STORE);
  
  const delReq = cs.delete(courseToDeleteId);
  delReq.onsuccess = () => {
    // Bu kursa ait tüm katılımcıları sil
    const idx = ps.index('courseId');
    const getReq = idx.getAll(courseToDeleteId);
    
    getReq.onsuccess = () => {
      const rows = getReq.result || [];
      const deleteReqs = rows.map(r => ps.delete(r.id));
      
      // Tüm silme işlemleri tamamlandığında
      Promise.all(deleteReqs.map(req => 
        new Promise(resolve => { req.onsuccess = resolve; req.onerror = resolve; })
      )).then(() => {
        removeParticipantsFromCourse(courseToDeleteId); // Yerel state'i güncelle
        courses = courses.filter(c => c.id !== courseToDeleteId);
        courseToDeleteId = null; 
        closeModal(deleteCourseModal); 
        renderCourses();
        notify('Ders ve tüm katılımcılar silindi.');
      });
    };
    
    getReq.onerror = () => {
      // Katılımcılar silinemese bile kursu silelim
      removeParticipantsFromCourse(courseToDeleteId);
      courses = courses.filter(c => c.id !== courseToDeleteId);
      courseToDeleteId = null; 
      closeModal(deleteCourseModal); 
      renderCourses();
      notify('Ders silindi (katılımcılar kısmen silinmiş olabilir).');
    };
  };
  
  delReq.onerror = () => notify('Ders silinirken bir hata oluştu!', 'error');
}