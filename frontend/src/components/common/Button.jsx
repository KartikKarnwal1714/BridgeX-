export default function Button({ children, variant = 'primary', size = 'md', icon: Icon, className = '', ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed'

  const variants = {
    primary: 'bg-primary-500 text-white hover:bg-primary-600 focus:ring-primary-400',
    secondary: 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 focus:ring-gray-300',
    ghost: 'text-gray-600 hover:bg-gray-100 focus:ring-gray-300',
    danger: 'bg-danger-500 text-white hover:bg-danger-600 focus:ring-danger-400',
    warning: 'bg-warning-500 text-white hover:bg-warning-600 focus:ring-warning-400',
  }

  const sizes = {
    sm: 'text-xs px-2.5 py-1.5',
    md: 'text-sm px-3.5 py-2',
    lg: 'text-sm px-5 py-2.5',
  }

  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {Icon && <Icon className="h-4 w-4" strokeWidth={2} />}
      {children}
    </button>
  )
}
