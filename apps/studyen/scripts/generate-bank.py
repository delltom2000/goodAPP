"""Reproducible original training variants. These are NOT past papers or calibrated IELTS items."""
import hashlib, json, pathlib, random, runpy
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'dist/data';OUT.mkdir(parents=True,exist_ok=True)
rng=random.Random(20261104)
sources=[
 {'id':'official-format','title':'IELTS 官方 Academic 样题与题型说明','url':'https://ielts.org/take-a-test/preparation-resources/sample-test-questions/academic-test','kind':'official-format','exam_date':None,'checked':'2026-11-04','note':'仅参考题型结构；官方样题页不等于最近一年实考试卷。'},
 {'id':'cambridge21','title':'Cambridge IELTS 21（2026 年 7 月出版）','url':'https://www.cambridge.es/en/catalogue/exams/practice-material/practice-tests/ielts','kind':'official-publication','exam_date':None,'checked':'2026-11-04','note':'已核实出版信息；未复制付费书籍内容，也未声称已取得其题目授权。'},
 {'id':'reported-oct26','title':'2026 年 10 月写作题考生回忆汇总','url':'https://ieltswritingpractice.app/recent-ielts-writing-questions/2026-10/','kind':'unverified-candidate-report','exam_date':'2026-10','checked':'2026-11-04','note':'仅作为健康、教育、媒体文化等话题线索；非官方核验，不作为标准答案或难度依据。'}
]
# Topic-specific mechanisms give each context meaningful content. Values and institutions below are fictional.
topics=[
 ('urban trees','tree planting','shade','surface temperatures','measured temperatures at midday','canopy cover blocks sunlight before it reaches the pavement','seasonal changes can alter the amount of shade'),
 ('public transport','bus priority lanes','reliability','journey times','recorded arrival times during the morning peak','separate lanes prevent buses from being delayed by private vehicles','roadworks can temporarily disrupt an otherwise reliable route'),
 ('building energy','insulation upgrades','heat retention','energy use','compared monthly meter readings','insulation slows the movement of heat through external walls','weather differences can affect demand for heating'),
 ('food waste','meal planning workshops','planning','food waste','weighed discarded food at the end of each week','planning portions reduces the amount of food purchased unnecessarily','self-reported shopping habits may be inaccurate'),
 ('water conservation','leak detection','early detection','water loss','checked water meters overnight','continuous monitoring reveals small leaks before they become visible','old meters may not detect very low flows'),
 ('library access','evening opening hours','accessibility','waiting times','counted queues at the service desk','longer opening hours distribute visits more evenly across the day','the examination season can increase demand independently'),
 ('digital learning','peer feedback sessions','feedback','revision errors','compared successive drafts of student work','explaining an error to another student encourages closer attention','students with greater confidence may dominate discussions'),
 ('bicycle safety','protected cycle lanes','separation','conflicts at junctions','reviewed video recordings of junctions','physical barriers separate cyclists from moving vehicles','junction design can remain a source of risk'),
 ('preventive health','community exercise groups','regular activity','inactive hours','analysed voluntary activity diaries','scheduled group activities make regular exercise easier to maintain','participants may overestimate their activity levels'),
 ('recycling','clearer sorting labels','clarity','sorting errors','examined the contents of recycling bins','pictures help users identify which materials belong in each container','collection rules can differ between neighbourhoods'),
 ('remote work','scheduled focus periods','concentration','interruptions','logged interruptions during working hours','shared quiet periods reduce unnecessary messages and meetings','some roles require continuous communication'),
 ('museum learning','interactive exhibits','participation','unanswered questions','asked visitors to explain an exhibit after their visit','handling a model can make an abstract process easier to understand','visitors who volunteer for a survey may already be interested'),
 ('coastal restoration','dune planting','stability','sand loss','measured changes along fixed survey lines','plant roots help hold loose sand in place','a single severe storm can dominate annual results'),
 ('student wellbeing','mentoring appointments','support','missed deadlines','compared anonymous deadline records','early advice helps students divide large assignments into manageable steps','students facing the greatest difficulties may not seek help'),
 ('local markets','shared delivery services','coordination','delivery journeys','counted delivery vehicles on market days','combining orders prevents several vehicles from following the same route','perishable goods may require separate storage'),
 ('noise reduction','acoustic panels','absorption','noise levels','measured sound during occupied periods','porous materials absorb some of the sound reflected by hard surfaces','the number of people in a room also affects sound levels'),
 ('wildlife monitoring','automatic camera surveys','coverage','missed observations','compared camera records with manual surveys','automatic equipment records activity when observers are absent','equipment can fail during prolonged wet weather'),
 ('adult education','flexible course schedules','flexibility','course withdrawals','reviewed attendance and withdrawal records','alternative schedules allow learners to combine study with other responsibilities','work patterns may change during the course'),
 ('cultural heritage','community archives','participation','unidentified records','audited a sample of catalogue entries','local residents can supply context missing from written records','memories may differ and need to be checked against other evidence'),
 ('urban gardening','shared composting','soil quality','organic waste','weighed material entering household waste bins','composting returns organic material to the soil instead of discarding it','poorly managed compost can attract pests')
]
towns=['Alderford','Brookhaven','Cedarwick','Dunmere','Elmbridge','Fairhaven','Glenford','Hazelton','Ivybridge','Juniper Bay','Kingsmere','Larkfield','Maplewick','Northmere','Oakford','Pinehaven','Queensbrook','Riverton','Stonefield','Willowmere']
questions=[]
def put(skill,tag,passage,q,options=None,answer=None,why='',**extra):
    number=sum(1 for x in questions if x['skill']==skill)+1
    # IDs stable across reproducible generation; do not renumber in future releases.
    prefix={'阅读':'R','听力':'L','语法':'G','写作':'W','口语':'S'}[skill]
    obj=dict(id=f'v2-{prefix}{number:05d}',skill=skill,tag=tag,passage=passage,q=q,options=options or [],answer=answer,why=why,
        quality='generated-unreviewed',difficulty='uncalibrated',sourceIds=['official-format'],origin='original-rule-generated',**extra)
    questions.append(obj)
def choice(skill,tag,passage,q,right,wrong,why,**extra):
    opts=[right,*wrong];rng.shuffle(opts);put(skill,tag,passage,q,opts,opts.index(right),why,**extra)

# 400 distinct fictional research contexts, with ten tasks each; 9 legacy reading items retained by app.js.
for t in range(400):
    topic,intervention,mechanism,measure,method,reason,limit=topics[t%20]
    town=towns[(t//20+t)%20];year=2012+t//40;duration=6+t%7;sites=8+(t*3)%17;before=80+t%31;after=before-(8+t%19);sample=120+(t*17)%381
    design=['a matched comparison group','a random allocation of sites','a phased introduction','a repeated survey','a retrospective comparison'][t//80]
    primary=f'The evaluation in {town} used {design}. The team included {sites} sites and collected information from {sample} participants. Baseline monitoring began in {year}, before the programme was introduced. The intervention phase lasted {duration} months. Researchers {method}; all measurements followed the same written procedure.'
    passage=f'''A. A local research group in {town} investigated {topic}. Earlier proposals had concentrated on buying equipment, but the new study asked whether {intervention} could improve everyday outcomes. The proposed explanation was that {reason}. The researchers described this mechanism as {mechanism}, while stressing that a plausible explanation alone is not evidence of success.

B. {primary} A separate team checked the records without being told which sites had received the intervention first.

C. On a standardised index of {measure}, where a lower score represented a better outcome, the average fell from {before} to {after}. The authors did not interpret this change as proof that the programme would work everywhere. They noted that {limit}. They also cautioned that a short evaluation may miss effects that emerge only over several years.

D. The report recommended a longer follow-up before extending the programme. It did not include a calculation of financial savings, and participation was voluntary. The next phase would examine whether the observed change could be sustained when the research team was no longer present. Local officials agreed to publish the methods so that other teams could repeat the work.'''
    common={'groupId':f'reading-{t:04d}','topic':topic,'family':f'research-{t%20}-{t//80}'}
    mode=t%3
    claim=[f'The intervention phase lasted {duration} months.',f'The intervention phase lasted {duration+3} months.',f'Most participants had previously worked as researchers.'][mode]
    put('阅读','tfng',passage,claim,['True','False','Not Given'],mode,['B 段明确给出相同的实施时长。','B 段给出的实施时长与题干不同。','文章没有说明参与者以前的职业。'][mode],taskType='true-false-not-given',**common)
    put('阅读','tfng',passage,'The study established the exact amount of money saved.',['True','False','Not Given'],1,'D 段说明没有计算财务节省，因此与题干矛盾。',taskType='true-false-not-given',**common)
    choice('阅读','detail',passage,'Which heading best describes paragraph C?','Promising results with important limitations',['A complete account of project funding','The history of the research institution'],'C 段先报告改善，再讨论限制。',taskType='matching-headings',**common)
    choice('阅读','detail',passage,'Which paragraph describes the selection and monitoring of the sample?','B',['A','D'],'B 段交代样本规模、设计和监测方法。',taskType='matching-information',**common)
    choice('阅读','detail',passage,'Why did the authors recommend a longer follow-up?','To check whether the changes would last',['To prove that every location had identical conditions','To replace all measurements with personal opinions'],'D 段的 sustained 指变化是否持续。',taskType='multiple-choice',**common)
    put('阅读','detail',passage,'Complete the note. Write ONE NUMBER ONLY.\nNumber of sites included: ___',why=f'B 段直接说明 included {sites} sites。',responseType='text',acceptedAnswers=[str(sites)],taskType='note-completion',wordLimit=1,**common)
    put('阅读','detail',passage,'Complete the summary. Write ONE WORD ONLY from the passage.\nThe explanation for the intervention was described as ___.',why=f'A 段将该机制概括为 {mechanism}。',responseType='text',acceptedAnswers=[mechanism],taskType='summary-completion',wordLimit=2 if ' ' in mechanism else 1,**common)
    # Adjust instruction where the target consists of two words.
    if ' ' in mechanism: questions[-1]['q']=questions[-1]['q'].replace('ONE WORD ONLY','NO MORE THAN TWO WORDS')
    put('阅读','detail',passage,'Complete the table. Write ONE NUMBER ONLY.\nAverage index after the intervention: ___',why=f'C 段给出指数从 {before} 降至 {after}。',responseType='text',acceptedAnswers=[str(after)],taskType='table-completion',wordLimit=1,**common)
    choice('阅读','detail',passage,'What does the author imply about a plausible mechanism?','It still needs empirical evidence',['It guarantees that the intervention will succeed','It makes monitoring unnecessary'],'A 段指出 plausible explanation alone is not evidence。',taskType='inference',**common)
    put('阅读','detail',passage,'Answer using ONE WORD ONLY from the passage.\nHow does the report describe the nature of participation in the study?',why='D 段以 voluntary 描述参加研究的性质。此题仅用于基础定位训练。',responseType='text',acceptedAnswers=['voluntary'],taskType='short-answer',wordLimit=1,practiceOnly=True,**common)
questions=questions[:3991]

# Listening scenarios: booking, corrections, navigation and academic project decisions.
activities=['community gardening','photography','creative writing','local history','public speaking','digital skills','bird watching','watercolour painting','bicycle maintenance','healthy cooking','museum volunteering','marine conservation','theatre production','pottery','urban planning','first aid','language exchange','nature recording','textile repair','science communication']
days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
for i in range(350):
    activity=activities[i%20];town=towns[(i//20)%20];day=days[i%7];old=days[(i+2)%7];room=20+i%67;fee=25+i%50;discount=fee-5;capacity=12+i%19;weeks=4+i%9;start=['9:15','10:30','11:45','13:20','14:10'][i%5];deadline=days[(i+5)%7]
    equipment=['a notebook','a water bottle','a pencil','a camera','a packed lunch'][i%5]
    equipment_answer=['notebook','water bottle','pencil','camera','packed lunch'][i%5]
    objective=['compare two teaching methods','identify barriers to participation','evaluate the booking system','measure changes in confidence','document how groups make decisions'][i%5]
    audio=f'''Receptionist: Welcome to the {town} learning centre. Are you asking about our {activity} course?
Visitor: Yes. The leaflet says it is on {old}.
Receptionist: That was the original arrangement. It has moved to {day}, although the starting time is still {start}. Please arrive fifteen minutes early for registration.
Visitor: Is it still in room {room+10}?
Receptionist: No, we are using room {room} now. The larger room is being repaired. The fee is {fee} pounds for the whole course, or {discount} pounds if you are a student. Materials are included.
Visitor: How long does it run, and is there space available?
Receptionist: It lasts {weeks} weeks. We can accept up to {capacity} participants. You need to book by {deadline}. Please bring {equipment}; everything else is provided. Payment can be made by card, but the booking itself must be completed online.
Visitor: How do I find the room?
Receptionist: From the main entrance, pass the reception desk, turn left at the stairs, and continue to the end of the corridor. The room is opposite the café. The entrance beside the car park is closed.
Tutor: We are also evaluating this course. Our main aim is to {objective}. We considered interviewing only the most confident participants, but that would give a distorted picture. Instead, we will invite everyone to complete an anonymous questionnaire. Taking part in the evaluation is optional and will not affect anyone's place on the course. We will report the results as group averages, without naming individuals.'''
    common={'groupId':f'listening-{i:04d}','topic':activity,'family':f'course-{i%20}-{i%5}'}
    choice('听力','listen',audio,'On which day will the course take place?',day,[old,days[(i+4)%7]],f'说话者更正了旧日期，最终为 {day}。',taskType='multiple-choice',**common)
    choice('听力','listen',audio,'What is the course starting time?',start,['8:00','16:00'],f'注意问的是课程开始时间 {start}，不是提前到场时间。',taskType='multiple-choice',**common)
    for prompt,ans,explanation in [('Room number',str(room),'原房间被更正，使用新的房间号。'),('Student fee in pounds',str(discount),'学生价格不同于普通价格。'),('Course duration in weeks',str(weeks),'课程持续周数。'),('Maximum number of participants',str(capacity),'注意人数上限而非价格。')]:
        put('听力','listen',audio,f'Complete the form. Write ONE NUMBER ONLY.\n{prompt}: ___',why=f'{explanation}答案：{ans}。',responseType='text',acceptedAnswers=[ans],wordLimit=1,taskType='form-completion',**common)
    put('听力','listen',audio,'Complete the note. Write ONE WORD ONLY.\nBooking deadline: ___',why=f'需要在 {deadline} 前预订。',responseType='text',acceptedAnswers=[deadline.lower()],wordLimit=1,taskType='note-completion',**common)
    put('听力','listen',audio,'Complete the note. Write NO MORE THAN TWO WORDS.\nParticipants should bring a ___.',why=f'需要自带 {equipment_answer}，其他物品已经提供。',responseType='text',acceptedAnswers=[equipment_answer],wordLimit=2,taskType='note-completion',**common)
    choice('听力','listen',audio,'Where is the course room?','Opposite the café',['Beside the closed car-park entrance','Directly behind the reception desk'],'路线说明最后指出房间在咖啡馆对面。',taskType='directions',**common)
    choice('听力','listen',audio,'What is the principal aim of the evaluation?',objective,[x for x in ['compare two teaching methods','identify barriers to participation','evaluate the booking system','measure changes in confidence','document how groups make decisions'] if x!=objective][:2],'Tutor 明确给出 main aim，随后介绍问卷调查。',taskType='multiple-choice',**common)
questions=questions[:3991+3494]

grammar=[]
for i in range(1491):
    topic,intervention,mechanism,measure,method,reason,limit=topics[i%20];town=towns[(i//20)%20];year=2000+i//400;form=i%9
    cases=[
      ('tense',f'The {topic} project in {town} ___ in {year}.','began',['has begun','begins'],'明确的过去时间使用一般过去时。'),
      ('agreement',f'The quality of the {topic} reports from {town} ___ consistent.','is',['are','have'],'真正的主语为单数 quality。'),
      ('logic',f'___ the limited budget in {year}, the {town} team completed its {topic} study.','Despite',['Although','Because'],'Despite 后接名词短语，表示让步。'),
      ('tense',f'By the time the {town} team published its {topic} report in {year}, the pilot ___ already ___.','had / ended',['has / ended','is / ending'],'过去事件之前发生的动作使用过去完成时。'),
      ('agreement',f'Each of the {town} researchers studying {topic} ___ responsible for checking the {year} data.','was',['were','have been'],'Each 作主语使用单数谓语。'),
      ('logic',f'The {town} evaluation of {topic} was delayed in {year} ___ several records were missing.','because',['despite','because of'],'because 后接完整原因从句。'),
      ('agreement',f'Information about the {year} {topic} programme in {town} ___ available on request.','is',['are','have'],'Information 为不可数名词，使用单数谓语。'),
      ('logic',f'___ the {town} study of {topic} lasted only six months in {year}, it produced useful evidence.','Although',['Despite','Because of'],'Although 后接完整让步从句。'),
      ('tense',f'The {town} team ___ the {topic} pilot when the funding announcement arrived in {year}.','was evaluating',['has evaluated','will evaluate'],'过去某个动作发生时正在进行的动作用过去进行时。')
    ]
    tag,q,right,wrong,why=cases[form]
    # Include a meaningful task context to disambiguate otherwise repeated combinations.
    context=f'Context: a report on {intervention}; focus on {mechanism}.'
    choice('语法',tag,context,q,right,wrong,why,groupId=f'grammar-{i:04d}',family=f'grammar-rule-{form}',topic=topic,taskType='grammar-choice')

domains=[('public transport','bus and rail networks'),('preventive health','community health programmes'),('higher education','university courses'),('cultural identity','local cultural traditions'),('media','international media platforms'),('school education','school curricula'),('housing','affordable housing'),('remote work','flexible employment'),('environment','conservation projects'),('technology','digital public services'),('tourism','tourism development'),('sport','community sports facilities'),('libraries','public libraries'),('food','sustainable food systems'),('water','water conservation'),('arts','public arts programmes'),('science','scientific research'),('urban planning','city redevelopment'),('languages','language learning'),('older people','services for older residents'),('children','children’s leisure activities'),('energy','renewable energy'),('rural communities','rural infrastructure'),('consumer behaviour','repair and reuse services'),('volunteering','community volunteering')]
angles=[
 ('opinion','Public funding for {b} should prioritise people with the least access to these services. To what extent do you agree or disagree?'),
 ('discussion','Some people want national authorities to make decisions about {b}, while others favour local control. Discuss both views and give your opinion.'),
 ('problem-solution','Many people cannot access {b} even when these services are available nearby. What might explain this, and how could access be improved?'),
 ('advantages-disadvantages','Private organisations are taking a larger role in providing {b}. Do the advantages of this development outweigh the disadvantages?'),
 ('two-part','Young adults are increasingly involved in decisions about {b}. Why might this be happening? Is this a positive development?'),
 ('opinion','Investment in {b} should be judged by long-term outcomes rather than immediate popularity. To what extent do you agree or disagree?'),
 ('discussion','Some believe that expert advice should determine policy on {b}. Others think the preferences of ordinary citizens should have greater influence. Discuss both views and give your opinion.'),
 ('problem-solution','Projects involving {b} sometimes receive initial support but are abandoned later. Why does this happen, and what could ensure their continuation?'),
 ('advantages-disadvantages','Information about {b} is increasingly provided only online. Do the advantages outweigh the disadvantages?'),
 ('two-part','There are large differences between communities in the quality of {b}. What causes these differences? Who should be responsible for addressing them?'),
 ('opinion','Organisations responsible for {b} should publish clear evidence of their results. To what extent do you agree or disagree?'),
 ('discussion','Some favour building new facilities for {b}, while others prefer improving existing ones. Discuss both views and give your opinion.'),
 ('problem-solution','Some attempts to improve {b} fail to include the people most affected. What problems can this create, and what can be done?'),
 ('advantages-disadvantages','International organisations are becoming more involved in local decisions about {b}. Do the advantages outweigh the disadvantages?'),
 ('two-part','People increasingly expect services related to {b} to meet individual needs. Why is this happening? Is this expectation reasonable?'),
 ('opinion','Schools should teach students how to evaluate public debates about {b}. To what extent do you agree or disagree?'),
 ('discussion','Some people want rapid changes in {b}, while others prefer small trials before wider reform. Discuss both views and give your opinion.'),
 ('problem-solution','Misleading claims about {b} can spread rapidly. What effects might this have, and how could the problem be reduced?'),
 ('advantages-disadvantages','Communities increasingly rely on volunteers to support {b}. Do the advantages outweigh the disadvantages?'),
 ('two-part','Environmental impact is becoming a major consideration in planning {b}. Why is this the case? What other factors should planners consider?')
]
speaking_angles=[('a conversation','who you spoke with; what you discussed; where the conversation happened'),('a useful website','how you found it; what information it provides; how often you use it'),('a place','where it is; what people do there; when you visited'),('a person who helped you','who the person is; what they did; when this happened'),('a decision','what the options were; how you decided; what happened afterwards'),('a change in your community','what changed; when it happened; who was affected'),('a skill','what the skill involves; how you learned it; when you use it'),('a memorable event','where it took place; who attended; what happened'),('a useful piece of advice','who gave it; what it was; when you followed it'),('a challenge','what made it difficult; what you tried; who helped'),('a documentary or article','where you encountered it; what it covered; what you learned'),('a group activity','who took part; how it was organised; what you contributed'),('a future plan','what you intend to do; when you hope to do it; how you will prepare'),('an unexpected experience','where you were; what happened; how you responded'),('an object you used','what it was; where you obtained it; how it helped'),('a mistake you learned from','what happened; how you noticed; what you did differently later'),('a successful project','what its aim was; who was involved; how success was measured'),('a time you changed your mind','what you first thought; what new information you received; what you decided'),('a lesson outside school','where you learned it; who was involved; how you applied it'),('an improvement you would suggest','what needs changing; who could act; what benefits you expect')]
for d,(topic,service) in enumerate(domains):
    for a,(typ,prompt) in enumerate(angles):
        put('写作','writing','',prompt.format(b=service),why='需人工或经过校准的评分服务评估；不以字数或关键词数量直接换算 Band。',responseType='essay',taskType=typ,wordTarget=250,timeMinutes=40,topic=topic,groupId=f'writing-{d}-{a}',family=f'writing-{typ}')
        if d<5: questions[-1]['sourceIds']=['official-format','reported-oct26']
    for a,(object_,cues) in enumerate(speaking_angles):
        put('口语','speaking','',f'Describe {object_} connected with {topic}.\nYou should say: {cues}.\nExplain why this experience or idea matters to you.',why='准备 1 分钟，表达 1–2 分钟；根据流利度、词汇、语法、发音进行人工评估。',responseType='speaking',taskType='part-2',timeMinutes=3,topic=topic,groupId=f'speaking-{d}-{a}',family=f'speaking-{a}')
# Add data-reporting tasks and the other two speaking parts without inflating the total.
for index,item in enumerate([q for q in questions if q['skill']=='写作']):
    if index%5==0:
        a=20+index%25;b=35+index%30;c=45+index%20
        item.update(taskType='task-1-table',wordTarget=150,timeMinutes=20,
          passage=f'Fictional survey: percentage of residents using services related to {item["topic"]}.\n\nAge group       2016       2021       2026\n18–34           {a}%        {a+10}%        {a+25}%\n35–54           {b}%        {b+5}%        {b+15}%\n55 and over     {c}%        {c+3}%        {c+8}%',
          q='The table shows the percentage of residents in three age groups who used the specified services in a fictional town. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.')
part1_sets=[
 '1. How often do you discuss this topic with friends?\n2. Has your interest in it changed since childhood?\n3. What would you like to learn about it?',
 '1. Where do you usually find information about this topic?\n2. Do people in your family share your interest?\n3. Would you like to attend an event related to it?',
 '1. When did you first become aware of this topic?\n2. Is it part of your daily routine?\n3. What aspect do you find most interesting?',
 '1. Is this topic commonly discussed where you live?\n2. Did you learn about it at school?\n3. Would you prefer to learn more alone or with other people?']
part3_sets=[
 '1. How might attitudes differ between generations?\n2. What role should public institutions play?\n3. How could developments affect society over the next twenty years?',
 '1. How can reliable information be distinguished from misleading claims?\n2. Should companies take responsibility for educating the public?\n3. Can international cooperation improve outcomes?',
 '1. What barriers might prevent people from participating?\n2. How could unequal access be reduced?\n3. Is equal access always more important than efficiency?',
 '1. How should success be measured?\n2. Why do public opinions sometimes differ from expert advice?\n3. What are the risks of making decisions without long-term evidence?']
for index,item in enumerate([q for q in questions if q['skill']=='口语']):
    if index%5==0:item.update(taskType='part-1',timeMinutes=5,q=f'Topic: {item["topic"]}\n'+part1_sets[(index//5)%4])
    elif index%5==4:item.update(taskType='part-3',timeMinutes=5,q=f'Topic: {item["topic"]}\n'+part3_sets[(index//5)%4])
authored=runpy.run_path(str(ROOT/'scripts/authored-reading.py'))['authored_questions']()
# Replace entries rather than inflate the headline count; new IDs preserve attribution.
replace_ids={q['id'] for q in questions if q['skill']=='阅读' and q.get('practiceOnly')}
replace_ids=set(sorted(replace_ids)[:len(authored)])
questions=[q for q in questions if q['id'] not in replace_ids]+authored
assert len(questions)==9976,len(questions)
assert len({q['id'] for q in questions})==len(questions)
assert len({(q['passage'],q['q']) for q in questions})==len(questions)
counts={s:sum(q['skill']==s for q in questions) for s in ['语法','阅读','听力','写作','口语']}
passages={}
for q in questions:
    if q['passage']:
        passage_id=hashlib.sha256(q['passage'].encode()).hexdigest()[:16]
        passages[passage_id]=q.pop('passage');q['passageId']=passage_id
payload={'version':'2026.11.04.2','generatedAt':'2026-11-04','referenceWindow':{'from':'2025-11-04','to':'2026-11-04'},'targetCount':10000,'legacyCount':24,'counts':counts,'sources':sources,'qualityNotice':'含规则生成训练变式和写作口语提示；未经教师逐题审核或雅思难度校准，不是最近一年真题集。','passages':passages,'questions':questions}
(OUT/'question-bank.json').write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print(json.dumps({'new':len(questions),'total':len(questions)+24,'counts':counts,'bytes':(OUT/'question-bank.json').stat().st_size},ensure_ascii=False))
