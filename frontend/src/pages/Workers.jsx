import { useEffect, useMemo, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import { useConfirmDialog } from "../components/DialogProvider";
import { formatUtcLocal } from "../utils/dateUtils";
import "./Workers.css";

const MANUAL_OPERATIONS = [
  "Manufacturing",
  "Handle fitting",
  "Polishing",
  "Grinding",
  "Quality check",
  "Packing",
  "Repair",
  "Other",
];

const TASK_VIEW_OPTIONS = [
  ["open", "Open tasks"],
  ["verification", "Verification"],
  ["history", "History"],
  ["all", "All tasks"],
];

const EMPTY_WORKER_FORM = {
  name: "",
  role: "",
  phone: "",
  email: "",
  department: "",
  rate_per_piece: 0,
  is_active: true,
};

const EMPTY_NEW_USER = {
  name: "",
  pin: "0000",
  phone: "",
  email: "",
  is_active: true,
};

const getDefaultDueDateTime = () => {
  const date = new Date();
  date.setHours(18, 0, 0, 0);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
};

const formatCurrency = (value) =>
  `Rs. ${Number(value || 0).toLocaleString("en-PK", {
    maximumFractionDigits: 0,
  })}`;

const normalizeStatusValue = (value) => String(value || "").trim().toLowerCase();
const FULFILLED_SHIPPING_STATUSES = new Set(["shipped", "dispatched", "in transit", "delivered"]);
const CANCELED_STATUSES = new Set(["canceled", "cancelled"]);
const ORDER_WORKFLOW_OPEN_STATUSES = new Set([
  "New",
  "Ready",
  "In Progress",
  "Pending Verification",
]);

const countOrderUnits = (order) =>
  (order.items || []).reduce(
    (total, item) => total + Number(item.quantity || 0),
    0
  );

const orderNeedsPreparation = (order) =>
  (order?.items || []).some((item) => item.manufacturing_required);

const latestTaskOfType = (tasks, taskType) =>
  [...(tasks || [])]
    .filter((task) => task.task_type === taskType)
    .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0] || null;

const isOpenOrderWorkflowTask = (task) =>
  ORDER_WORKFLOW_OPEN_STATUSES.has(task?.status);

const getOrderTaskQuantity = (task) =>
  Number(
    task.assigned_quantity ||
      (Array.isArray(task.items)
        ? task.items.reduce((total, item) => total + Number(item.quantity || 0), 0)
        : 0) ||
      1
  );

const getTaskEarning = (task) =>
  Number(
    task.labor_cost ||
      Number(task.completed_quantity || getOrderTaskQuantity(task) || 0) *
        Number(task.rate_per_piece || 0)
  );

function Workers() {
  const confirmDialog = useConfirmDialog();
  const [workers, setWorkers] = useState([]);
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showManualTaskForm, setShowManualTaskForm] = useState(false);
  const [editingWorkerId, setEditingWorkerId] = useState(null);
  const [detailsWorker, setDetailsWorker] = useState(null);
  const [assignmentMode, setAssignmentMode] = useState("none");
  const [assignedUserId, setAssignedUserId] = useState(null);
  const [manualTaskSaving, setManualTaskSaving] = useState(false);
  const [manualTaskMessage, setManualTaskMessage] = useState("");
  const [manualTaskError, setManualTaskError] = useState("");
  const [productionTasks, setProductionTasks] = useState([]);
  const [orderWorkflowTasks, setOrderWorkflowTasks] = useState([]);
  const [workerPayments, setWorkerPayments] = useState([]);
  const [taskBoardLoading, setTaskBoardLoading] = useState(true);
  const [taskBoardView, setTaskBoardView] = useState("open");
  const [taskWorkerFilter, setTaskWorkerFilter] = useState("all");
  const [taskActionBusy, setTaskActionBusy] = useState("");
  const [taskBoardMessage, setTaskBoardMessage] = useState("");
  const [taskBoardError, setTaskBoardError] = useState("");
  const [orderHandoffForms, setOrderHandoffForms] = useState({});
  const [orderHandoffSaving, setOrderHandoffSaving] = useState("");
  const [orderHandoffCanceling, setOrderHandoffCanceling] = useState("");
  const [orderHandoffMessage, setOrderHandoffMessage] = useState("");
  const [orderHandoffError, setOrderHandoffError] = useState("");
  const [manualTaskForm, setManualTaskForm] = useState({
    worker_id: "",
    product_mode: "inventory",
    product_id: "",
    custom_product_name: "",
    custom_article_no: "",
    step_name: "Polishing",
    custom_operation: "",
    assigned_quantity: 1,
    rate_per_piece: "",
    due_date: getDefaultDueDateTime(),
    notes: "",
  });
  const [newUser, setNewUser] = useState(EMPTY_NEW_USER);

  const [form, setForm] = useState(EMPTY_WORKER_FORM);

  const fetchWorkers = async () => {
    try {
      const response = await api.get("/workers");
      setWorkers(response.data);
    } catch (error) {
      console.error("Workers loading error:", error);
      alert("Backend not connected.");
    }
  };

  const fetchUsers = async () => {
    try {
      const response = await api.get("/users");
      setUsers(response.data || []);
    } catch (error) {
      console.error("Users loading error:", error);
    }
  };

  const fetchProducts = async () => {
    try {
      const response = await api.get("/products");
      setProducts(response.data || []);
    } catch (error) {
      console.error("Products loading error:", error);
    }
  };

  const fetchOrders = async () => {
    try {
      const response = await api.get("/orders");
      setOrders(response.data || []);
    } catch (error) {
      console.error("Orders loading error:", error);
      setOrderHandoffError("Unfulfilled orders could not be loaded.");
    }
  };

  const fetchProductionTasks = async () => {
    try {
      setTaskBoardLoading(true);
      const response = await api.get("/production/tasks");
      setProductionTasks((response.data || []).filter((task) => task.worker_id));
    } catch (error) {
      console.error("Production tasks loading error:", error);
      setTaskBoardError("Worker task board could not be loaded.");
    } finally {
      setTaskBoardLoading(false);
    }
  };

  const fetchOrderWorkflowTasks = async () => {
    try {
      const response = await api.get("/order-workflow/tasks");
      setOrderWorkflowTasks(response.data || []);
    } catch (error) {
      console.error("Order workflow tasks loading error:", error);
    }
  };

  const fetchWorkerPayments = async () => {
    try {
      const response = await api.get("/worker-payments");
      setWorkerPayments(response.data || []);
    } catch (error) {
      console.error("Worker payments loading error:", error);
    }
  };

  useEffect(() => {
    const loadAll = async () => {
      await fetchWorkers();
      await fetchUsers();
      await fetchProducts();
      await fetchOrders();
      await fetchProductionTasks();
      await fetchOrderWorkflowTasks();
      await fetchWorkerPayments();
    };
    loadAll();
  }, []);

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;

    setForm({
      ...form,
      [name]: type === "checkbox" ? checked : value,
    });
  };

  const getLinkedUser = (workerId) =>
    users.find((user) => String(user.worker_id || "") === String(workerId));

  const resetWorkerForm = () => {
    setForm(EMPTY_WORKER_FORM);
    setNewUser(EMPTY_NEW_USER);
    setAssignmentMode("none");
    setAssignedUserId(null);
    setEditingWorkerId(null);
  };

  const openAddWorker = () => {
    resetWorkerForm();
    setShowForm(true);
  };

  const closeWorkerForm = () => {
    setShowForm(false);
    setEditingWorkerId(null);
  };

  const startEditWorker = (worker) => {
    setForm({
      name: worker.name || "",
      role: worker.role || "",
      phone: worker.phone || "",
      email: worker.email || "",
      department: worker.department || "",
      rate_per_piece: worker.rate_per_piece ?? 0,
      is_active: Boolean(worker.is_active),
    });
    setNewUser(EMPTY_NEW_USER);
    setAssignmentMode("none");
    setAssignedUserId(null);
    setEditingWorkerId(worker.id);
    setShowForm(true);
  };

  const availableUsers = users.filter(
    (user) => user.role !== "admin" && !user.worker_id
  );
  const hasAvailableWorkerUsers = availableUsers.length > 0;

  useEffect(() => {
    if (hasAvailableWorkerUsers || assignmentMode !== "existing") {
      return undefined;
    }
    const resetId = window.setTimeout(() => {
      setAssignmentMode("none");
      setAssignedUserId(null);
    }, 0);
    return () => window.clearTimeout(resetId);
  }, [assignmentMode, hasAvailableWorkerUsers]);

  const handleManualTaskChange = (field, value) => {
    setManualTaskForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "worker_id"
        ? {
            rate_per_piece:
              workers.find((worker) => String(worker.id) === String(value))
                ?.rate_per_piece ?? "",
          }
        : {}),
      ...(field === "product_mode" && value === "custom" ? { product_id: "" } : {}),
      ...(field === "product_mode" && value === "inventory"
        ? { custom_product_name: "", custom_article_no: "" }
        : {}),
    }));
  };

  const getDefaultOrderHandoffForm = (order) => {
    const orderTasks = orderWorkflowTasks.filter(
      (task) => Number(task.order_id) === Number(order.id)
    );
    const preparationTask = latestTaskOfType(
      orderTasks.filter((task) => task.status !== "Canceled"),
      "Preparation"
    );
    return {
      task_type:
        orderNeedsPreparation(order) && !preparationTask ? "Preparation" : "Shipping",
      worker_id: "",
      due_at: "",
      labor_cost: "",
      notes: "",
    };
  };

  const getOrderHandoffForm = (order) =>
    orderHandoffForms[order.id] || getDefaultOrderHandoffForm(order);

  const handleOrderHandoffChange = (order, field, value) => {
    setOrderHandoffForms((current) => ({
      ...current,
      [order.id]: {
        ...getDefaultOrderHandoffForm(order),
        ...(current[order.id] || {}),
        [field]: value,
      },
    }));
  };

  const assignOrderWorkflowTask = async (order, event) => {
    event.preventDefault();
    const handoffForm = getOrderHandoffForm(order);

    if (!handoffForm.worker_id) {
      setOrderHandoffError("Select the worker who should receive this order task.");
      return;
    }
    if (handoffForm.labor_cost !== "" && Number(handoffForm.labor_cost) < 0) {
      setOrderHandoffError("Worker earning cannot be negative.");
      return;
    }

    let currentUser;
    try {
      currentUser = JSON.parse(window.localStorage.getItem("erpUser") || "null");
    } catch {
      currentUser = null;
    }

    const selectedWorker = workers.find(
      (worker) => String(worker.id) === String(handoffForm.worker_id)
    );
    const orderQuantity = countOrderUnits(order);
    const taskType = handoffForm.task_type;
    const openExistingTask = orderWorkflowTasks.find(
      (task) =>
        Number(task.order_id) === Number(order.id) &&
        task.task_type === taskType &&
        isOpenOrderWorkflowTask(task)
    );

    if (openExistingTask) {
      const assignedName = openExistingTask.assigned_worker_name || "this worker";
      const sameWorker =
        String(openExistingTask.assigned_worker_id || "") ===
        String(handoffForm.worker_id || "");
      setOrderHandoffError(
        sameWorker
          ? `${taskType} is already assigned to ${assignedName}. Cancel it before assigning again.`
          : `${taskType} is already assigned to ${assignedName}. Cancel the current assignment before assigning another worker.`
      );
      return;
    }

    setOrderHandoffSaving(String(order.id));
    setOrderHandoffError("");
    setOrderHandoffMessage("");
    try {
      await api.post(`/orders/${order.id}/workflow-tasks`, {
        task_type: taskType,
        worker_id: Number(handoffForm.worker_id),
        assigned_quantity: orderQuantity || null,
        rate_per_piece: selectedWorker?.rate_per_piece ?? null,
        labor_cost:
          handoffForm.labor_cost === "" ? null : Number(handoffForm.labor_cost),
        due_at: handoffForm.due_at ? new Date(handoffForm.due_at).toISOString() : null,
        notes: handoffForm.notes.trim() || null,
        assigned_by_user_id: currentUser?.id || null,
        assigned_by_user_name: currentUser?.name || currentUser?.username || null,
      });
      setOrderHandoffMessage(`${handoffForm.task_type} task assigned for order ${order.order_no}.`);
      setOrderHandoffForms((current) => ({
        ...current,
        [order.id]: {
          ...getDefaultOrderHandoffForm(order),
          worker_id: handoffForm.worker_id,
          labor_cost: "",
          notes: "",
        },
      }));
      await fetchOrderWorkflowTasks();
      await fetchOrders();
    } catch (error) {
      console.error("Order handoff error:", error);
      setOrderHandoffError(
        error.response?.data?.detail || "Order task could not be assigned."
      );
    } finally {
      setOrderHandoffSaving("");
    }
  };

  const cancelOrderWorkflowTask = async (task) => {
    if (!task?.id) return;
    const confirmed = await confirmDialog({
      title: "Cancel assignment?",
      message: `Cancel ${task.task_type} for order ${task.order_no || ""} from ${
        task.assigned_worker_name || "this worker"
      }?`,
      tone: "warning",
      confirmText: "Cancel assignment",
    });
    if (!confirmed) return;

    setOrderHandoffCanceling(String(task.id));
    setOrderHandoffError("");
    setOrderHandoffMessage("");
    try {
      await api.patch(`/order-workflow/tasks/${task.id}/cancel`);
      setOrderHandoffMessage(`${task.task_type} assignment canceled.`);
      await fetchOrderWorkflowTasks();
    } catch (error) {
      console.error("Order workflow cancel error:", error);
      setOrderHandoffError(
        error.response?.data?.detail || "Order assignment could not be canceled."
      );
    } finally {
      setOrderHandoffCanceling("");
    }
  };

  const saveManualTask = async (event) => {
    event.preventDefault();
    setManualTaskError("");
    setManualTaskMessage("");

    if (!manualTaskForm.worker_id) {
      setManualTaskError("Select the worker for this task.");
      return;
    }
    const isCustomProduct = manualTaskForm.product_mode === "custom";
    if (!isCustomProduct && !manualTaskForm.product_id) {
      setManualTaskError("Select the product/article for this task.");
      return;
    }
    if (isCustomProduct && !manualTaskForm.custom_product_name.trim()) {
      setManualTaskError("Enter the custom work note for this non-inventory job.");
      return;
    }
    const taskStepName =
      manualTaskForm.step_name === "Other"
        ? manualTaskForm.custom_operation.trim()
        : manualTaskForm.step_name.trim();

    if (!taskStepName) {
      setManualTaskError("Enter the task operation.");
      return;
    }
    if (Number(manualTaskForm.assigned_quantity) <= 0) {
      setManualTaskError("Quantity must be greater than 0.");
      return;
    }

    const worker = workers.find(
      (item) => String(item.id) === String(manualTaskForm.worker_id)
    );

    setManualTaskSaving(true);
    try {
      await api.post("/production/manual-tasks", {
        product_id: isCustomProduct ? null : Number(manualTaskForm.product_id),
        custom_product_name: isCustomProduct
          ? manualTaskForm.custom_product_name.trim()
          : null,
        custom_article_no: isCustomProduct
          ? manualTaskForm.custom_article_no.trim() || null
          : null,
        worker_id: Number(manualTaskForm.worker_id),
        step_name: taskStepName,
        assigned_quantity: Number(manualTaskForm.assigned_quantity),
        due_date: manualTaskForm.due_date
          ? new Date(manualTaskForm.due_date).toISOString()
          : null,
        notes: manualTaskForm.notes.trim() || null,
        worker_role: worker?.role || null,
        rate_per_piece: Number(
          manualTaskForm.rate_per_piece === ""
            ? worker?.rate_per_piece || 0
            : manualTaskForm.rate_per_piece
        ),
      });
      setManualTaskMessage("Today's task assigned to worker dashboard.");
      setTaskBoardMessage("Task added to open worker tasks.");
      setManualTaskForm((current) => ({
        ...current,
        product_id: "",
        custom_product_name: "",
        custom_article_no: "",
        step_name: "Polishing",
        custom_operation: "",
        assigned_quantity: 1,
        rate_per_piece: worker?.rate_per_piece ?? "",
        due_date: getDefaultDueDateTime(),
        notes: "",
      }));
      fetchProductionTasks();
      setShowManualTaskForm(false);
    } catch (error) {
      console.error("Manual task save error:", error);
      setManualTaskError(
        error.response?.data?.detail || "Manual task could not be assigned."
      );
    } finally {
      setManualTaskSaving(false);
    }
  };

  const completeWorkerTask = async (task) => {
    const workerName = task.worker_name || "worker";
    const isOrderTask = task.task_kind === "order";
    const taskId = task.original_id || task.id;
    const isVerification = task.status === "Pending Verification";
    const confirmed = await confirmDialog({
      title: isVerification ? "Verify completed task?" : "Complete worker task?",
      message: isVerification
        ? `Verify ${task.step_name} for ${workerName} and add the earning to the worker account?`
        : `Mark ${task.step_name} for ${workerName} as completed?`,
      tone: "warning",
      confirmText: isVerification ? "Verify complete" : "Mark completed",
    });
    if (!confirmed) return;

    setTaskActionBusy(`complete-${task.task_kind || "production"}-${taskId}`);
    setTaskBoardError("");
    setTaskBoardMessage("");

    try {
      if (isOrderTask) {
        await api.patch(`/order-workflow/tasks/${taskId}/complete`, {
          note: "Verified completed by admin.",
          verify: true,
        });
      } else {
        await api.patch(`/production/tasks/${taskId}/complete`, {
          completed_quantity: Number(
            task.completed_quantity || task.assigned_quantity || 0
          ),
          delay_reason: null,
          verify: true,
        });
      }
      setTaskBoardMessage(
        isVerification
          ? "Worker task verified and earning added."
          : "Worker task marked completed."
      );
      await fetchProductionTasks();
      await fetchOrderWorkflowTasks();
      await fetchOrders();
    } catch (error) {
      console.error("Complete worker task error:", error);
      setTaskBoardError(
        error.response?.data?.detail || "Task could not be marked completed."
      );
    } finally {
      setTaskActionBusy("");
    }
  };

  const saveWorker = async (event) => {
    event.preventDefault();

    const payload = {
      ...form,
      name: form.name.trim(),
      role: form.role.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      department: form.department.trim() || null,
      rate_per_piece: Number(form.rate_per_piece),
    };

    if (!payload.name) {
      alert("Enter the worker name.");
      return;
    }
    if (!payload.role) {
      alert("Enter the worker role.");
      return;
    }

    if (editingWorkerId) {
      try {
        await api.put(`/workers/${editingWorkerId}`, payload);
        await fetchWorkers();
        await fetchProductionTasks();
        closeWorkerForm();
        alert("Worker updated successfully.");
      } catch (error) {
        console.error("Update worker error:", error);
        alert(error.response?.data?.detail || "Worker could not be updated.");
      }
      return;
    }

    if (assignmentMode === "existing" && !assignedUserId) {
      alert("Select an existing user to assign to this worker.");
      return;
    }

    if (assignmentMode === "new") {
      if (!newUser.name.trim()) {
        alert("Enter a name for the new user account.");
        return;
      }
      if (!/^\d{4}$/.test(newUser.pin)) {
        alert("User PIN must be 4 digits.");
        return;
      }
    }

    let createdWorker = null;
    try {
      const response = await api.post("/workers", payload);
      createdWorker = response.data;

      if (assignmentMode === "existing") {
        const existingUser = users.find((user) => user.id === assignedUserId);
        if (existingUser) {
          await api.put(`/users/${existingUser.id}`, {
            name: existingUser.name,
            username: existingUser.username || existingUser.name,
            role: "worker",
            phone: existingUser.phone,
            email: existingUser.email,
            session_expiry_minutes: existingUser.session_expiry_minutes ?? 0,
            is_active: existingUser.is_active,
            worker_id: createdWorker.id,
          });
        }
      }

      if (assignmentMode === "new") {
        await api.post("/users", {
          name: newUser.name.trim(),
          pin: newUser.pin,
          role: "worker",
          phone: newUser.phone.trim() || null,
          email: newUser.email.trim() || null,
          is_active: newUser.is_active,
          worker_id: createdWorker.id,
        });
      }

      resetWorkerForm();
      setShowForm(false);
      await fetchWorkers();
      await fetchUsers();
      alert("Worker added successfully.");
    } catch (error) {
      console.error("Save worker error:", error);
      if (createdWorker?.id) {
        try {
          await api.delete(`/workers/${createdWorker.id}`);
        } catch (cleanupError) {
          console.error("Cleanup worker error:", cleanupError);
        }
      }
      alert(error.response?.data?.detail || "Worker could not be saved.");
    }
  };

  const deleteWorker = async (workerId) => {
    const worker = workers.find((item) => item.id === workerId);
    const linkedUser = getLinkedUser(workerId);
    const confirmDelete = await confirmDialog({
      title: "Delete worker?",
      message: linkedUser
        ? `Delete ${worker?.name || "this worker"} and the linked ERP user account for ${linkedUser.name}?`
        : `Delete ${worker?.name || "this worker"} from the workers page?`,
      tone: "danger",
      confirmText: "Delete worker",
    });
    if (!confirmDelete) return;

    try {
      await api.delete(`/workers/${workerId}`);
      await fetchWorkers();
      await fetchUsers();
      await fetchProductionTasks();
      if (detailsWorker?.id === workerId) setDetailsWorker(null);
      alert("Worker deleted successfully.");
    } catch (error) {
      console.error("Delete worker error:", error);
      alert("Worker could not be deleted.");
    }
  };

  const activeWorkers = workers.filter((worker) => worker.is_active);
  const inactiveWorkers = workers.filter((worker) => !worker.is_active);
  const orderWorkflowTasksByOrderId = useMemo(() => {
    const grouped = new Map();
    orderWorkflowTasks.forEach((task) => {
      const orderId = Number(task.order_id);
      if (!grouped.has(orderId)) grouped.set(orderId, []);
      grouped.get(orderId).push(task);
    });
    return grouped;
  }, [orderWorkflowTasks]);
  const unfulfilledOrders = useMemo(
    () =>
      orders
        .filter((order) => {
          const shippingStatus = normalizeStatusValue(order.shipping_status);
          return (
            !CANCELED_STATUSES.has(shippingStatus) &&
            !FULFILLED_SHIPPING_STATUSES.has(shippingStatus)
          );
        })
        .sort(
          (a, b) =>
            new Date(b.order_date || 0).getTime() -
              new Date(a.order_date || 0).getTime() ||
            Number(b.id || 0) - Number(a.id || 0)
        ),
    [orders]
  );
  const combinedWorkerTasks = useMemo(() => {
    const normalizedProductionTasks = productionTasks.map((task) => ({
      ...task,
      task_kind: "production",
      original_id: task.id,
    }));
    const normalizedOrderTasks = orderWorkflowTasks
      .filter((task) => task.assigned_worker_id && task.status !== "Canceled")
      .map((task) => {
        const items = Array.isArray(task.items) ? task.items : [];
        const firstItem = items[0] || {};
        const assignedQuantity = Number(
          task.assigned_quantity ||
            items.reduce((total, item) => total + Number(item.quantity || 0), 0) ||
            1
        );
        return {
          ...task,
          id: `order-${task.id}`,
          original_id: task.id,
          task_kind: "order",
          source_type: "Order",
          worker_id: task.assigned_worker_id,
          worker_name: task.assigned_worker_name,
          step_name: task.title || `${task.task_type || "Order"} task`,
          article_no: task.order_no ? `Order #${task.order_no}` : "Order",
          product_name:
            items
              .map((item) => item.article_no || item.product_name)
              .filter(Boolean)
              .join(", ") || task.customer_name || "Order workflow",
          product_image_url: firstItem.product_image_url || null,
          assigned_quantity: assignedQuantity,
          completed_quantity:
            task.status === "Completed"
              ? Number(task.completed_quantity || assignedQuantity)
              : Number(task.completed_quantity || 0),
          expected_completion_time: task.due_at,
          actual_start_time: task.started_at,
          actual_completion_time: task.completed_at,
          timing_status:
            task.due_at &&
            task.status !== "Completed" &&
            new Date(task.due_at) < new Date()
              ? "Late"
              : task.status === "New"
                ? "Unstarted"
                : task.status || "Open",
        };
      });
    return [...normalizedOrderTasks, ...normalizedProductionTasks];
  }, [orderWorkflowTasks, productionTasks]);
  const openTaskCount = combinedWorkerTasks.filter(
    (task) => task.status !== "Completed"
  ).length;
  const verificationTaskCount = combinedWorkerTasks.filter(
    (task) => task.status === "Pending Verification"
  ).length;
  const completedTaskCount = combinedWorkerTasks.filter(
    (task) => task.status === "Completed"
  ).length;
  const filteredWorkerTasks = useMemo(() => {
    return combinedWorkerTasks.filter((task) => {
      const matchesWorker =
        taskWorkerFilter === "all" ||
        String(task.worker_id || "") === String(taskWorkerFilter);
      const matchesView =
        taskBoardView === "all" ||
        (taskBoardView === "open" && task.status !== "Completed") ||
        (taskBoardView === "verification" &&
          task.status === "Pending Verification") ||
        (taskBoardView === "history" && task.status === "Completed");
      return matchesWorker && matchesView;
    });
  }, [combinedWorkerTasks, taskBoardView, taskWorkerFilter]);
  const workerLedger = useMemo(
    () =>
      workers.map((worker) => {
        const workerTasks = productionTasks.filter(
          (task) => String(task.worker_id || "") === String(worker.id)
        );
        const workerOrderTasks = orderWorkflowTasks.filter(
          (task) => String(task.assigned_worker_id || "") === String(worker.id)
        );
        const completedTasks = workerTasks.filter(
          (task) => task.status === "Completed"
        );
        const completedOrderTasks = workerOrderTasks.filter(
          (task) => task.status === "Completed"
        );
        const earned = completedTasks.reduce(
          (total, task) => total + getTaskEarning(task),
          0
        ) + completedOrderTasks.reduce(
          (total, task) => total + getTaskEarning(task),
          0
        );
        const paid = workerPayments
          .filter((payment) => String(payment.worker_id) === String(worker.id))
          .reduce((total, payment) => total + Number(payment.amount || 0), 0);

        return {
          worker_id: worker.id,
          open_tasks:
            workerTasks.filter((task) => task.status !== "Completed").length +
            workerOrderTasks.filter((task) => task.status !== "Completed").length,
          completed_tasks: completedTasks.length + completedOrderTasks.length,
          earned,
          paid,
          balance: earned - paid,
        };
      }),
    [orderWorkflowTasks, productionTasks, workerPayments, workers]
  );
  const ledgerByWorkerId = useMemo(
    () => new Map(workerLedger.map((item) => [item.worker_id, item])),
    [workerLedger]
  );
  const totalEarned = workerLedger.reduce((total, item) => total + item.earned, 0);
  const totalPaid = workerLedger.reduce((total, item) => total + item.paid, 0);
  const detailsLinkedUser = detailsWorker ? getLinkedUser(detailsWorker.id) : null;
  const detailsLedger = detailsWorker
    ? ledgerByWorkerId.get(detailsWorker.id) || {}
    : {};

  return (
    <div className="workers-page">
      <header className="topbar workers-topbar">
        <div>
          <span className="workers-page-kicker">Factory team</span>
          <h1>Workers</h1>
        </div>

        <div className="workers-top-actions">
          <button className="primary-btn" onClick={openAddWorker} type="button">
            + Add Worker
          </button>
          <button
            className="secondary-btn workers-action-button"
            onClick={() => {
              setManualTaskMessage("");
              setManualTaskError("");
              setShowManualTaskForm(true);
            }}
            type="button"
          >
            Assign Task
          </button>
        </div>
      </header>

      <section className="stats-grid">
        <div className="stat-card">
          <p>Total Workers</p>
          <h2>{workers.length}</h2>
          <span>All factory workers</span>
        </div>

        <div className="stat-card">
          <p>Active Workers</p>
          <h2>{activeWorkers.length}</h2>
          <span>Available for tasks</span>
        </div>

        <div className="stat-card warning">
          <p>Inactive Workers</p>
          <h2>{inactiveWorkers.length}</h2>
          <span>Not currently active</span>
        </div>

        <div className="stat-card">
          <p>Worker Balance</p>
          <h2>{formatCurrency(totalEarned - totalPaid)}</h2>
          <span>{formatCurrency(totalPaid)} paid</span>
        </div>
      </section>

      <section className="workers-assignment-panel">
        <div className="workers-panel-heading workers-assignment-heading">
          <div>
            <h2>Assignments</h2>
          </div>
          <div className="workers-assignment-actions">
            <div className="workers-task-board-stats">
              <span>
                <strong>{unfulfilledOrders.length}</strong>
                Orders
              </span>
              <span>
                <strong>{openTaskCount}</strong>
                Open tasks
              </span>
            </div>
            <button
              className="primary-btn workers-assignment-button"
              onClick={() => {
                setManualTaskMessage("");
                setManualTaskError("");
                setShowManualTaskForm(true);
              }}
              type="button"
            >
              Assign task
            </button>
          </div>
        </div>

        {showManualTaskForm && (
          <div
            className="workers-modal-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setShowManualTaskForm(false);
            }}
            role="presentation"
          >
            <section
              aria-modal="true"
              className="form-panel workers-modal workers-task-modal"
              role="dialog"
            >
              <div className="workers-modal-header">
                <div>
                  <h3>Assign worker task</h3>
                </div>
                <button
                  aria-label="Close manual task form"
                  className="workers-modal-close"
                  onClick={() => setShowManualTaskForm(false)}
                  type="button"
                >
                  x
                </button>
              </div>

        <form className="workers-manual-task-form workers-modal-form" onSubmit={saveManualTask}>
          <label>
            Worker
            <select
              value={manualTaskForm.worker_id}
              onChange={(event) =>
                handleManualTaskChange("worker_id", event.target.value)
              }
            >
              <option value="">Select worker</option>
              {activeWorkers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.name} / {worker.role || "Worker"}
                </option>
              ))}
            </select>
          </label>

          <label>
            Work source
            <select
              value={manualTaskForm.product_mode}
              onChange={(event) =>
                handleManualTaskChange("product_mode", event.target.value)
              }
            >
              <option value="inventory">Inventory article</option>
              <option value="custom">Custom non-inventory work</option>
            </select>
          </label>

          {manualTaskForm.product_mode === "inventory" ? (
            <label>
              Product / article
            <select
              value={manualTaskForm.product_id}
              onChange={(event) =>
                handleManualTaskChange("product_id", event.target.value)
              }
            >
              <option value="">Select product</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.article_no} / {product.name}
                </option>
              ))}
            </select>
            </label>
          ) : (
            <>
              <label className="workers-custom-work">
                Custom work note
                <input
                  value={manualTaskForm.custom_product_name}
                  onChange={(event) =>
                    handleManualTaskChange("custom_product_name", event.target.value)
                  }
                  placeholder="Example: repair old sample handle"
                />
              </label>
              <label>
                Custom ref
                <input
                  value={manualTaskForm.custom_article_no}
                  onChange={(event) =>
                    handleManualTaskChange("custom_article_no", event.target.value)
                  }
                  placeholder="Optional"
                />
              </label>
            </>
          )}

          <label>
            Operation
            <select
              value={manualTaskForm.step_name}
              onChange={(event) =>
                handleManualTaskChange("step_name", event.target.value)
              }
            >
              {MANUAL_OPERATIONS.map((operation) => (
                <option key={operation} value={operation}>
                  {operation}
                </option>
              ))}
            </select>
          </label>

          {manualTaskForm.step_name === "Other" && (
            <label className="workers-custom-operation">
              Custom operation
              <input
                value={manualTaskForm.custom_operation}
                onChange={(event) =>
                  handleManualTaskChange("custom_operation", event.target.value)
                }
                placeholder="Example: blade oiling"
              />
            </label>
          )}

          <label>
            Quantity
            <input
              min="1"
              type="number"
              value={manualTaskForm.assigned_quantity}
              onChange={(event) =>
                handleManualTaskChange("assigned_quantity", event.target.value)
              }
            />
          </label>

          <label>
            Rate / piece
            <input
              min="0"
              type="number"
              value={manualTaskForm.rate_per_piece}
              onChange={(event) =>
                handleManualTaskChange("rate_per_piece", event.target.value)
              }
              placeholder="Worker default"
            />
          </label>

          <label>
            Due today
            <input
              type="datetime-local"
              value={manualTaskForm.due_date}
              onChange={(event) =>
                handleManualTaskChange("due_date", event.target.value)
              }
            />
          </label>

          <label className="workers-manual-task-notes">
            Notes
            <input
              value={manualTaskForm.notes}
              onChange={(event) =>
                handleManualTaskChange("notes", event.target.value)
              }
              placeholder="Example: urgent polish before packing"
            />
          </label>

          <button
            className="primary-btn workers-manual-task-submit"
            disabled={manualTaskSaving}
            type="submit"
          >
            {manualTaskSaving ? "Assigning..." : "Assign task"}
          </button>
        </form>
            </section>
          </div>
        )}

        {manualTaskMessage && (
          <p className="workers-task-success">{manualTaskMessage}</p>
        )}
        {manualTaskError && <p className="workers-task-error">{manualTaskError}</p>}

        <div className="workers-assignment-subhead">
          <strong>Unfulfilled orders</strong>
          <span>{unfulfilledOrders.length}</span>
        </div>

        {orderHandoffMessage && (
          <p className="workers-task-success">{orderHandoffMessage}</p>
        )}
        {orderHandoffError && (
          <p className="workers-task-error">{orderHandoffError}</p>
        )}

        {unfulfilledOrders.length === 0 ? (
          <div className="workers-task-empty">No unfulfilled orders waiting for workers.</div>
        ) : (
          <div className="workers-order-handoff-list">
            {unfulfilledOrders.map((order) => {
              const handoffForm = getOrderHandoffForm(order);
              const orderTasks = orderWorkflowTasksByOrderId.get(Number(order.id)) || [];
              const selectedWorker = activeWorkers.find(
                (worker) => String(worker.id) === String(handoffForm.worker_id)
              );
              const orderQuantity = countOrderUnits(order);
              const suggestedCost =
                selectedWorker && orderQuantity
                  ? Number(selectedWorker.rate_per_piece || 0) * orderQuantity
                  : 0;
              const isSaving = orderHandoffSaving === String(order.id);
              const selectedOpenTask = orderTasks.find(
                (task) =>
                  task.task_type === handoffForm.task_type &&
                  isOpenOrderWorkflowTask(task)
              );
              const visibleOrderTasks = [...orderTasks]
                .sort(
                  (a, b) =>
                    Number(isOpenOrderWorkflowTask(b)) -
                      Number(isOpenOrderWorkflowTask(a)) ||
                    Number(b.id || 0) - Number(a.id || 0)
                )
                .slice(0, 4);
              const isCanceling =
                selectedOpenTask &&
                orderHandoffCanceling === String(selectedOpenTask.id);

              return (
                <article className="workers-order-handoff-card" key={order.id}>
                  <div className="workers-order-handoff-main">
                    <div className="workers-order-handoff-summary">
                      <strong>Order #{order.order_no}</strong>
                      <span>{order.customer_name || "Customer"}</span>
                      <span>
                        {orderQuantity} pcs / {order.shipping_status || "Pending"}
                      </span>
                    </div>
                    <div className="workers-order-handoff-tags">
                      {visibleOrderTasks.length === 0 ? (
                        <span>No worker task</span>
                      ) : (
                        visibleOrderTasks.map((task) => (
                          <span
                            className={
                              isOpenOrderWorkflowTask(task) ? "is-open" : ""
                            }
                            key={task.id}
                          >
                            {task.task_type}: {task.assigned_worker_name || "Worker"} / {task.status}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <form
                    className="workers-order-handoff-form"
                    onSubmit={(event) => assignOrderWorkflowTask(order, event)}
                  >
                    <label>
                      Step
                      <select
                        onChange={(event) =>
                          handleOrderHandoffChange(order, "task_type", event.target.value)
                        }
                        value={handoffForm.task_type}
                      >
                        <option value="Preparation">Preparation</option>
                        <option value="Shipping">Shipping</option>
                      </select>
                    </label>
                    <label>
                      Worker
                      <select
                        onChange={(event) =>
                          handleOrderHandoffChange(order, "worker_id", event.target.value)
                        }
                        value={handoffForm.worker_id}
                      >
                        <option value="">Select worker</option>
                        {activeWorkers.map((worker) => (
                          <option key={worker.id} value={worker.id}>
                            {worker.name} / {worker.role || "Worker"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Due
                      <input
                        onChange={(event) =>
                          handleOrderHandoffChange(order, "due_at", event.target.value)
                        }
                        type="datetime-local"
                        value={handoffForm.due_at}
                      />
                    </label>
                    <label>
                      Worker earning
                      <input
                        min="0"
                        onChange={(event) =>
                          handleOrderHandoffChange(order, "labor_cost", event.target.value)
                        }
                        placeholder={
                          suggestedCost
                            ? `Suggested ${formatCurrency(suggestedCost)}`
                            : "Total earning"
                        }
                        step="0.01"
                        type="number"
                        value={handoffForm.labor_cost}
                      />
                    </label>
                    <label className="workers-order-handoff-note">
                      Note
                      <input
                        onChange={(event) =>
                          handleOrderHandoffChange(order, "notes", event.target.value)
                        }
                        placeholder="Packing, stock, label, or courier instruction"
                        value={handoffForm.notes}
                      />
                    </label>
                    {selectedOpenTask && (
                      <div className="workers-order-handoff-lock">
                        {handoffForm.task_type} with{" "}
                        {selectedOpenTask.assigned_worker_name || "Worker"} /{" "}
                        {selectedOpenTask.status}
                      </div>
                    )}
                    <button
                      className={
                        selectedOpenTask
                          ? "workers-order-handoff-cancel"
                          : "primary-btn workers-order-handoff-submit"
                      }
                      disabled={isSaving || isCanceling}
                      onClick={
                        selectedOpenTask
                          ? () => cancelOrderWorkflowTask(selectedOpenTask)
                          : undefined
                      }
                      type={selectedOpenTask ? "button" : "submit"}
                    >
                      {selectedOpenTask
                        ? isCanceling
                          ? "Canceling..."
                          : "Cancel current"
                        : isSaving
                          ? "Assigning..."
                          : "Assign"}
                    </button>
                  </form>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="workers-task-board-panel">
        <div className="workers-panel-heading workers-task-board-heading">
          <div>
            <h2>Tasks</h2>
          </div>
          <div className="workers-task-board-stats">
            <span>
              <strong>{openTaskCount}</strong>
              Open
            </span>
            <span>
              <strong>{verificationTaskCount}</strong>
              Verify
            </span>
            <span>
              <strong>{completedTaskCount}</strong>
              Completed
            </span>
          </div>
        </div>

        <div className="workers-task-board-controls">
          <div className="workers-task-tabs" aria-label="Task board view">
            {TASK_VIEW_OPTIONS.map(([value, label]) => (
              <button
                aria-pressed={taskBoardView === value}
                className={taskBoardView === value ? "is-active" : ""}
                key={value}
                onClick={() => setTaskBoardView(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          <select
            aria-label="Filter tasks by worker"
            value={taskWorkerFilter}
            onChange={(event) => setTaskWorkerFilter(event.target.value)}
          >
            <option value="all">All workers</option>
            {workers.map((worker) => (
              <option key={worker.id} value={worker.id}>
                {worker.name}
              </option>
            ))}
          </select>

          <button
            className="workers-task-refresh"
            onClick={() => {
              fetchProductionTasks();
              fetchOrderWorkflowTasks();
            }}
            type="button"
          >
            Refresh
          </button>
        </div>

        {taskBoardMessage && (
          <p className="workers-task-success">{taskBoardMessage}</p>
        )}
        {taskBoardError && <p className="workers-task-error">{taskBoardError}</p>}

        {taskBoardLoading ? (
          <div className="workers-task-empty">Loading worker tasks...</div>
        ) : filteredWorkerTasks.length === 0 ? (
          <div className="workers-task-empty">
            {taskBoardView === "history"
              ? "No completed task history yet."
              : taskBoardView === "verification"
                ? "No tasks waiting for admin verification."
              : "No open worker tasks right now."}
          </div>
        ) : (
          <div className="workers-task-list">
            {filteredWorkerTasks.map((task) => {
              const imageUrl = getStaticUrl(task.product_image_url);
              const busyKey = `complete-${task.task_kind || "production"}-${
                task.original_id || task.id
              }`;
              const canComplete = [
                "Ready",
                "In Progress",
                "Pending Verification",
              ].includes(task.status);

              return (
                <article
                  className={`workers-task-card ${
                    task.status === "Completed" ? "is-completed" : ""
                  } ${task.timing_status === "Late" ? "is-late" : ""}`}
                  key={`${task.task_kind}-${task.id}`}
                >
                  <div className="workers-task-main">
                    {imageUrl ? (
                      <img
                        alt={task.article_no || "Product"}
                        className="workers-task-thumb"
                        src={imageUrl}
                      />
                    ) : (
                      <span className="workers-task-thumb workers-task-thumb-empty">
                        {task.product_id ? "SKU" : "JOB"}
                      </span>
                    )}

                    <div>
                      <span className="workers-task-sku">
                        {task.product_id ? "SKU" : "Custom"} {task.article_no || "-"}
                      </span>
                      <h3>{task.step_name}</h3>
                      <p>
                        {task.product_name || "Custom work"} /{" "}
                        {task.worker_name || "Not assigned"}
                      </p>
                    </div>
                  </div>

                  <div className="workers-task-meta">
                    <span className={`workers-task-status is-${task.status.toLowerCase().replace(/\s+/g, "-")}`}>
                      {task.status}
                    </span>
                    {task.source_type === "Manual" && (
                      <span className="workers-task-status is-manual">Manual</span>
                    )}
                    {task.source_type === "Order" && (
                      <span className="workers-task-status is-order">Order</span>
                    )}
                    <span>Qty {task.completed_quantity}/{task.assigned_quantity}</span>
                    <span>Due {task.expected_completion_time ? formatUtcLocal(task.expected_completion_time) : "-"}</span>
                    {task.status === "Completed" && (
                      <span>
                        Done{" "}
                        {task.actual_completion_time
                          ? formatUtcLocal(task.actual_completion_time)
                          : "-"}
                      </span>
                    )}
                  </div>

                  <div className="workers-task-actions">
                    {task.status === "Completed" ? (
                      <span className="workers-task-done">Closed</span>
                    ) : canComplete ? (
                      <button
                        className="workers-task-complete"
                        disabled={taskActionBusy === busyKey}
                        onClick={() => completeWorkerTask(task)}
                        type="button"
                      >
                        {taskActionBusy === busyKey
                          ? task.status === "Pending Verification"
                            ? "Verifying..."
                            : "Closing..."
                          : task.status === "Pending Verification"
                            ? "Verify complete"
                            : "Mark complete"}
                      </button>
                    ) : (
                      <span className="workers-task-waiting">Waiting</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {showForm && (
        <div
          className="workers-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeWorkerForm();
          }}
          role="presentation"
        >
          <section
            aria-modal="true"
            className="form-panel workers-modal"
            role="dialog"
          >
            <div className="workers-modal-header">
              <div>
                <span>Worker setup</span>
                <h3>{editingWorkerId ? "Edit Worker" : "Add New Worker"}</h3>
              </div>
              <button
                aria-label="Close worker form"
                className="workers-modal-close"
                onClick={closeWorkerForm}
                type="button"
              >
                x
              </button>
            </div>

            <form className="product-form workers-modal-form" onSubmit={saveWorker}>
            <div className="form-group">
              <label>Worker Name</label>
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="Ali Khan"
                required
              />
            </div>

            <div className="form-group">
              <label>Role</label>
              <input
                name="role"
                value={form.role}
                onChange={handleChange}
                placeholder="Grinder"
                required
              />
            </div>

            <div className="form-group">
              <label>Phone</label>
              <input
                name="phone"
                value={form.phone}
                onChange={handleChange}
                placeholder="0300 0000000"
              />
            </div>

            <div className="form-group">
              <label>Email</label>
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                placeholder="worker@example.com"
              />
            </div>

            <div className="form-group">
              <label>Department</label>
              <input
                name="department"
                value={form.department}
                onChange={handleChange}
                placeholder="Production"
              />
            </div>

            <div className="form-group">
              <label>Rate Per Piece</label>
              <input
                type="number"
                name="rate_per_piece"
                value={form.rate_per_piece}
                onChange={handleChange}
                min="0"
              />
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox"
                name="is_active"
                checked={form.is_active}
                onChange={handleChange}
              />
              Active worker
            </label>

            {!editingWorkerId && (
              <div className="form-group">
              <label>ERP Account</label>
              <select
                value={assignmentMode}
                onChange={(e) => {
                  const value = e.target.value;
                  setAssignmentMode(value);
                  if (value !== "existing") {
                    setAssignedUserId(null);
                  }
                  if (value !== "new") {
                    setNewUser({ name: "", pin: "0000", phone: "", email: "", is_active: true });
                  }
                }}
              >
                <option value="none">No ERP user account</option>
                {hasAvailableWorkerUsers && (
                  <option value="existing">Assign existing ERP user</option>
                )}
                <option value="new">Create new worker user</option>
              </select>
              {!hasAvailableWorkerUsers && (
                <small className="workers-account-hint">
                  No unlinked non-admin ERP user accounts are available.
                </small>
              )}
              </div>
            )}

            {!editingWorkerId && assignmentMode === "existing" && (
              <div className="form-group">
                <label>Existing ERP user</label>
                {hasAvailableWorkerUsers ? (
                  <select
                    value={assignedUserId ?? ""}
                    onChange={(e) =>
                      setAssignedUserId(e.target.value ? Number(e.target.value) : null)
                    }
                  >
                    <option value="">Select user account</option>
                    {availableUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name} ({user.role} / {user.email || user.phone || "no contact"})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="workers-account-empty">
                    <p>No unlinked non-admin ERP user accounts are available.</p>
                    <button
                      type="button"
                      onClick={() => {
                        setAssignedUserId(null);
                        setAssignmentMode("new");
                      }}
                    >
                      Create new worker user
                    </button>
                  </div>
                )}
              </div>
            )}

            {!editingWorkerId && assignmentMode === "new" && (
              <>
                <div className="form-group">
                  <label>User Name</label>
                  <input
                    name="name"
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                    placeholder="ERP login name"
                  />
                </div>
                <div className="form-group">
                  <label>PIN</label>
                  <input
                    name="pin"
                    value={newUser.pin}
                    onChange={(e) => setNewUser({ ...newUser, pin: e.target.value.replace(/\D/g, "") })}
                    placeholder="0000"
                    maxLength={4}
                  />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input
                    name="phone"
                    value={newUser.phone}
                    onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                    placeholder="Optional phone"
                  />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input
                    name="email"
                    type="email"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    placeholder="Optional email"
                  />
                </div>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={newUser.is_active}
                    onChange={(e) => setNewUser({ ...newUser, is_active: e.target.checked })}
                  />
                  Active user account
                </label>
              </>
            )}

              <div className="workers-modal-actions">
                <button
                  className="secondary-btn"
                  onClick={closeWorkerForm}
                  type="button"
                >
                  Cancel
                </button>
                <button className="primary-btn form-submit" type="submit">
                  {editingWorkerId ? "Save Changes" : "Save Worker"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      <section className="panel">
        <div className="panel-header">
          <h3>Worker List</h3>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Department</th>
                <th>Rate / Piece</th>
                <th>Jobs</th>
                <th>Earned</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {workers.length === 0 ? (
                <tr>
                  <td colSpan="12">No workers added yet.</td>
                </tr>
              ) : (
                workers.map((worker) => {
                  const ledger = ledgerByWorkerId.get(worker.id) || {};
                  return (
                    <tr key={worker.id}>
                      <td>{worker.name}</td>
                      <td>{worker.role}</td>
                      <td>{worker.phone || "-"}</td>
                      <td>{worker.email || "-"}</td>
                      <td>{worker.department || "-"}</td>
                      <td>{formatCurrency(worker.rate_per_piece)}</td>
                      <td>
                        {ledger.open_tasks || 0} open / {ledger.completed_tasks || 0} done
                      </td>
                      <td>{formatCurrency(ledger.earned)}</td>
                      <td>{formatCurrency(ledger.paid)}</td>
                      <td>{formatCurrency(ledger.balance)}</td>
                      <td>
                        {worker.is_active ? (
                          <span className="badge success">Active</span>
                        ) : (
                          <span className="badge danger">Inactive</span>
                        )}
                      </td>
                      <td className="workers-actions-cell">
                        <div className="workers-row-actions">
                          <button
                            className="workers-row-action"
                            onClick={() => setDetailsWorker(worker)}
                            type="button"
                          >
                            View details
                          </button>
                          <button
                            className="workers-row-action"
                            onClick={() => startEditWorker(worker)}
                            type="button"
                          >
                            Edit
                          </button>
                          <button
                            className="workers-row-action is-danger"
                            onClick={() => deleteWorker(worker.id)}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {detailsWorker && (
        <div
          className="workers-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDetailsWorker(null);
          }}
          role="presentation"
        >
          <section
            aria-modal="true"
            className="form-panel workers-modal workers-details-modal"
            role="dialog"
          >
            <div className="workers-modal-header">
              <div>
                <span>Worker details</span>
                <h3>{detailsWorker.name}</h3>
              </div>
              <button
                aria-label="Close worker details"
                className="workers-modal-close"
                onClick={() => setDetailsWorker(null)}
                type="button"
              >
                x
              </button>
            </div>

            <div className="workers-details-body">
              <div className="workers-detail-grid">
                <div className="workers-detail-item">
                  <span>Role</span>
                  <strong>{detailsWorker.role || "-"}</strong>
                </div>
                <div className="workers-detail-item">
                  <span>Status</span>
                  <strong>{detailsWorker.is_active ? "Active" : "Inactive"}</strong>
                </div>
                <div className="workers-detail-item">
                  <span>Phone</span>
                  <strong>{detailsWorker.phone || "-"}</strong>
                </div>
                <div className="workers-detail-item">
                  <span>Email</span>
                  <strong>{detailsWorker.email || "-"}</strong>
                </div>
                <div className="workers-detail-item">
                  <span>Department</span>
                  <strong>{detailsWorker.department || "-"}</strong>
                </div>
                <div className="workers-detail-item">
                  <span>Rate per piece</span>
                  <strong>{formatCurrency(detailsWorker.rate_per_piece)}</strong>
                </div>
                <div className="workers-detail-item">
                  <span>Jobs</span>
                  <strong>
                    {detailsLedger.open_tasks || 0} open /{" "}
                    {detailsLedger.completed_tasks || 0} completed
                  </strong>
                </div>
                <div className="workers-detail-item">
                  <span>Earned</span>
                  <strong>{formatCurrency(detailsLedger.earned)}</strong>
                </div>
                <div className="workers-detail-item">
                  <span>Paid</span>
                  <strong>{formatCurrency(detailsLedger.paid)}</strong>
                </div>
                <div className="workers-detail-item">
                  <span>Balance</span>
                  <strong>{formatCurrency(detailsLedger.balance)}</strong>
                </div>
                <div className="workers-detail-item">
                  <span>Created</span>
                  <strong>
                    {detailsWorker.created_at
                      ? formatUtcLocal(detailsWorker.created_at)
                      : "-"}
                  </strong>
                </div>
                <div className="workers-detail-item">
                  <span>ERP account</span>
                  <strong>
                    {detailsLinkedUser
                      ? `${detailsLinkedUser.name} / ${detailsLinkedUser.role}`
                      : "Not linked"}
                  </strong>
                </div>
              </div>

              <div className="workers-modal-actions">
                <button
                  className="secondary-btn"
                  onClick={() => setDetailsWorker(null)}
                  type="button"
                >
                  Close
                </button>
                <button
                  className="primary-btn"
                  onClick={() => {
                    const workerToEdit = detailsWorker;
                    setDetailsWorker(null);
                    startEditWorker(workerToEdit);
                  }}
                  type="button"
                >
                  Edit Worker
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default Workers;
